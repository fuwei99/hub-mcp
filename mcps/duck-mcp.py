"""DuckDuckGo MCP（原版 TS server 子进程桥）：ddg_get_answer / ddg_search / ddg_search_news / ddg_search_images / ddg_search_videos / ddg_fetch_content / ddg_get_suggestions / ddg_get_definition / ddg_convert_currency。子进程用 node 跑 dist/index.js（Dockerfile 已构建）。"""
import asyncio
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

_state = {"session": None, "session_cm": None, "tools": None, "cm": None, "lock": None}


def _get_lock():
    if _state["lock"] is None:
        _state["lock"] = asyncio.Lock()
    return _state["lock"]


async def _spawn():
    from mcp import ClientSession
    from mcp.client.stdio import StdioServerParameters, stdio_client

    cmd = os.environ.get("DUCK_MCP_CMD", "bash")
    args = ["-c", f"cd {shlex.quote(str(DUCK_DIR))} && exec node dist/index.js"]
    params = StdioServerParameters(command=cmd, args=args)
    cm = stdio_client(params)
    read, write = await cm.__aenter__()
    session_cm = ClientSession(read, write)
    session = await session_cm.__aenter__()
    await asyncio.wait_for(session.initialize(), timeout=60)
    _state["session_cm"] = session_cm
    _state["cm"] = cm
    _state["session"] = session
    return session


async def _get_session():
    lock = _get_lock()
    async with lock:
        if _state["session"] is None:
            await _spawn()
        return _state["session"]


async def _reset():
    lock = _get_lock()
    async with lock:
        scm = _state["session_cm"]
        cm = _state["cm"]
        _state["session"] = None
        _state["session_cm"] = None
        _state["tools"] = None
        _state["cm"] = None
        if scm is not None:
            try:
                await scm.__aexit__(None, None, None)
            except Exception:
                pass
        if cm is not None:
            try:
                await cm.__aexit__(None, None, None)
            except Exception:
                pass


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
