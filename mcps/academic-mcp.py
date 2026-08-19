"""学术论文 MCP（academic-mcp 子进程桥）：paper_search / paper_download / paper_read（19+ 学术源，免 key）"""
import asyncio
import os
from pathlib import Path

from mcp import types
from mcp.server import Server

MOUNT = "academic"
KEY_ENV = "ACADEMIC_KEY"
DEFAULT_KEY = "wei123.."

server = Server("academic-bridge")

_state = {"session": None, "tools": None, "cm": None, "lock": None}


def _get_lock():
    if _state["lock"] is None:
        _state["lock"] = asyncio.Lock()
    return _state["lock"]


async def _spawn():
    from mcp import ClientSession
    from mcp.client.stdio import StdioServerParameters, stdio_client

    cmd = os.environ.get("ACADEMIC_MCP_CMD", "/opt/academic-venv/bin/academic-mcp")
    params = StdioServerParameters(command=cmd, args=[])
    cm = stdio_client(params)
    read, write = await cm.__aenter__()
    session = ClientSession(read, write)
    await session.initialize()
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
        s = _state["session"]
        cm = _state["cm"]
        _state["session"] = None
        _state["tools"] = None
        _state["cm"] = None
        if s is not None:
            try:
                await s.aclose()
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
