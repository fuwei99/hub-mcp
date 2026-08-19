"""DuckDuckGo MCP（原版 TS server 子进程桥）：ddg_get_answer / ddg_search / ddg_search_news / ddg_search_images / ddg_search_videos / ddg_fetch_content / ddg_get_suggestions / ddg_get_definition / ddg_convert_currency。子进程用 node 跑 dist/index.js（Dockerfile 已构建）。"""
import os
import shlex
from pathlib import Path

from mcp import types
from mcp.server import Server

MOUNT = "duck"
KEY_ENV = "DUCK_KEY"
DEFAULT_KEY = "wei123.."

DUCK_DIR = Path(__file__).resolve().parent.parent / "duck-mcp"

server = Server("duck-bridge")

_state = {"session": None, "tools": None}


async def _spawn():
    """把原版 TS server（bun 跑的 stdio MCP）拉起来当子进程。"""
    from mcp import ClientSession
    from mcp.client.stdio import stdio_client

    cmd = os.environ.get("DUCK_MCP_CMD", "bash")
    args = ["-c", f"cd {shlex.quote(str(DUCK_DIR))} && exec node dist/index.js"]
    # 兼容 mcp==1.2.0（无 env 参数、返回 2 元组）与新版；子进程默认继承父进程环境
    streams = await stdio_client(cmd, args)
    read, write = streams[0], streams[1]
    session = ClientSession(read, write)
    await session.initialize()
    return session


async def _get_session():
    if _state["session"] is None:
        _state["session"] = await _spawn()
    return _state["session"]


async def _reset():
    s = _state["session"]
    if s is not None:
        try:
            await s.aclose()
        except Exception:
            pass
    _state["session"] = None
    _state["tools"] = None


async def _get_tools():
    if _state["tools"] is None:
        s = await _get_session()
        res = await s.list_tools()
        _state["tools"] = res.tools
    return _state["tools"]


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    try:
        tools = await _get_tools()
    except Exception:
        await _reset()
        tools = await _get_tools()
    return [
        types.Tool(name=t.name, description=t.description or "", inputSchema=t.inputSchema)
        for t in tools
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    try:
        s = await _get_session()
        res = await s.call_tool(name, arguments or {})
    except Exception:
        await _reset()
        s = await _get_session()
        res = await s.call_tool(name, arguments or {})
    out = []
    for c in res.content:
        text = c.text if getattr(c, "type", None) == "text" else str(c)
        out.append(types.TextContent(type="text", text=text))
    return out
