#!/usr/bin/env python3
"""
MCP Hub — 一个 HF Space 挂多个 MCP Server（按 local-mcp-hub 的插件玩法重构）。

    端点：/<name>/sse（MCP SSE）；插件可自带额外 REST 路由（如 /ddg/search、/ddg/scrape）
    结构：
        main.py          ← 插件自动发现 + 鉴权壳 + 路由装配，加新 MCP 不用动它
        mcps/<name>.py   ← 一个 MCP 一个文件

插件约定：
    1. 单挂载：模块级 `server = Server(...)`；文件名即路径，可选 `MOUNT = "别名"` 覆盖
    2. 多挂载：模块级 `MOUNTS = {"path": srv, ...}`（一个 py 挂多个端点）
    3. 鉴权：`KEY_ENV` + `DEFAULT_KEY`（对该插件所有端点生效）；
       逐端点覆盖用 `KEYS = {"path": (env, default)}`
    4. 额外 REST（单挂载）：`ROUTES = [starlette.Route(...)]`，相对本插件路径挂载
    5. 状态上报：`SECRETS = {"标签": "ENV名", ...}`，首页显示上游是否已配置
    6. `ENABLED = False` 停用

下划线开头的文件（_utils.py 之类）自动跳过，只当库用（可被插件 `import _xxx`）。
"""
import importlib.util
import os
import sys
import traceback
from pathlib import Path

import uvicorn
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from mcp.server.sse import SseServerTransport

BASE = Path(__file__).resolve().parent
PLUGIN_DIR = BASE / "mcps"
PORT = int(os.environ.get("PORT", "7860"))
HOST = os.environ.get("HOST", "0.0.0.0")

sys.path.insert(0, str(PLUGIN_DIR))  # 让插件能 `import _xxx` 引用同目录库文件


def load_plugins():
    """扫 mcps/*.py，返回 [(name, srv, about, extra_routes, key, secrets)]；坏的不影响其他。"""
    found, failed = [], []
    for f in sorted(PLUGIN_DIR.glob("*.py")):
        if f.name.startswith("_"):
            continue
        try:
            spec = importlib.util.spec_from_file_location(f"mcps.{f.stem}", f)
            mod = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = mod
            spec.loader.exec_module(mod)

            if getattr(mod, "ENABLED", True) is False:
                print(f"  - {f.name:24s} 已停用 (ENABLED=False)", flush=True)
                continue
            about = (mod.__doc__ or "").strip().splitlines()[0] if mod.__doc__ else ""
            secrets = dict(getattr(mod, "SECRETS", None) or {})
            routes = list(getattr(mod, "ROUTES", None) or [])
            key_env = getattr(mod, "KEY_ENV", None)
            default_key = getattr(mod, "DEFAULT_KEY", "")
            overrides = dict(getattr(mod, "KEYS", None) or {})

            def key_for(path: str) -> str:
                if path in overrides:
                    env, dft = overrides[path]
                    return os.environ.get(env, dft).strip()
                if key_env:
                    return os.environ.get(key_env, default_key).strip()
                return ""

            multi = getattr(mod, "MOUNTS", None)
            if isinstance(multi, dict) and multi:
                for path, srv in multi.items():
                    p = str(path).strip("/")
                    found.append((p, srv, about, [], key_for(p), secrets))
                continue

            srv = getattr(mod, "server", None)
            if srv is None:
                failed.append((f.name, "模块里没有 server = Server(...) 也没有 MOUNTS 字典"))
                continue
            name = getattr(mod, "MOUNT", f.stem).strip("/")
            found.append((name, srv, about, routes, key_for(name), secrets))
        except Exception as e:
            failed.append((f.name, f"{type(e).__name__}: {e}"))
            traceback.print_exc()
    return found, failed


def make_sse_handler(transport, srv):
    async def handle_sse(request):
        async with transport.connect_sse(request.scope, request.receive, request._send) as streams:
            await srv.run(*streams, srv.create_initialization_options())
    return handle_sse


plugins, broken = load_plugins()
AUTH = {name: key for name, _s, _a, _r, key, _x in plugins}

mounts = []
for name, srv, _about, extra, _key, _secrets in plugins:
    transport = SseServerTransport(f"/{name}/messages/")
    inner = [
        Route("/sse", endpoint=make_sse_handler(transport, srv)),
        Mount("/messages/", app=transport.handle_post_message),
    ]
    inner.extend(extra)
    mounts.append(Mount(f"/{name}", app=Starlette(routes=inner)))


def check_key(authorization, expected):
    if not expected:
        return None
    if not authorization or not authorization.startswith("Bearer "):
        return 401, "缺少 Authorization: Bearer <key>"
    if authorization.split(" ", 1)[1].strip() != expected:
        return 403, "访问 key 错误"
    return None


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        p = request.url.path
        for name in sorted(AUTH, key=len, reverse=True):
            if p == name or p.startswith(name + "/"):
                err = check_key(request.headers.get("authorization"), AUTH[name])
                if err:
                    return JSONResponse({"error": err[1]}, status_code=err[0])
                break
        return await call_next(request)


async def index(request):
    return JSONResponse({
        "service": "MCP Hub",
        "version": "3.0.0",
        "endpoints": {n: f"/{n}/sse" for n, _s, _a, _r, _k, _x in plugins},
        "about": {n: a for n, _s, a, _r, _k, _x in plugins},
        "auth": {n: ("Bearer <key>" if k else "未配置") for n, _s, _a, _r, k, _x in plugins},
        "upstream_configured": {
            n: {label: bool(os.environ.get(env)) for label, env in sec.items()}
            for n, _s, _a, _r, _k, sec in plugins
        },
        "broken": dict(broken) or None,
        "plugin_dir": str(PLUGIN_DIR),
    })


app = Starlette(
    routes=[*mounts, Route("/", endpoint=index)],
    middleware=[Middleware(AuthMiddleware)],
)

if __name__ == "__main__":
    print(f"[mcp-hub] {HOST}:{PORT}  插件目录 {PLUGIN_DIR}", flush=True)
    for name, _s, about, _r, _k, _x in plugins:
        print(f"  ✓ /{name}/sse  {about}", flush=True)
    for fn, err in broken:
        print(f"  ✗ {fn}  加载失败: {err}", flush=True)
    if not plugins:
        print("  (一个插件都没加载成功)", flush=True)
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
