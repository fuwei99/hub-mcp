"""学术论文 MCP（academic-mcp 子进程桥）：paper_search / paper_download / paper_read（18 学术源，免 key）"""
from mcp import types
from mcp.server import Server

from _stdio_bridge import StdioBridge

MOUNT = "academic"
KEY_ENV = "ACADEMIC_KEY"
DEFAULT_KEY = "wei123.."

server = Server("academic-bridge")


def _params():
    import os

    from mcp.client.stdio import StdioServerParameters

    cmd = os.environ.get("ACADEMIC_MCP_CMD", "/opt/academic-venv/bin/academic-mcp")
    return StdioServerParameters(command=cmd, args=[])


# 学术源多、初始化慢，超时给宽些
bridge = StdioBridge(_params, timeout=150.0)


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return await bridge.list_tools()


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    return await bridge.call_tool(name, arguments)
