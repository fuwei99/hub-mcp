"""学术论文 MCP（academic-mcp 子进程桥）：paper_search / paper_download / paper_read（19+ 学术源，免 key）"""
import os
import shlex
from pathlib import Path

from mcp import types
from mcp.server import Server

MOUNT = "academic"
KEY_ENV = "ACADEMIC_KEY"
DEFAULT_KEY = "wei123.."

server = Server("academic-bridge")

_state = {"session": None, "tools": None}


async def _spawn_stdio(cmd: str, args: list[str]):
    """跨 mcp 版本拉起 stdio 子进程：
    - mcp 1.2.0: stdio_client(server: StdioServerParameters)（单参数，env 默认白名单继承）
    - mcp 1.29+: stdio_client(command, args=...)
    """
    import inspect

    from mcp.client.stdio import stdio_client

    params = inspect.signature(stdio_client).parameters
    if "server" in params:
        from mcp.client.stdio import StdioServerParameters

        streams = await stdio_client(StdioServerParameters(command=cmd, args=args))
    else:
        streams = await stdio_client(cmd, args=args)
    return streams[0], streams[1]  # 兼容 2 元组/3 元组返回


async def _spawn():
    """把 academic-mcp（独立 venv 里的 stdio MCP）拉起来当子进程。"""
    from mcp import ClientSession

    cmd = os.environ.get("ACADEMIC_MCP_CMD", "/opt/academic-venv/bin/academic-mcp")
    read, write = await _spawn_stdio(cmd, [])
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
