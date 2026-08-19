"""DuckDuckGo 搜索 MCP（duck-mcp TS 原版子进程桥）：搜索/新闻/图片/视频/抓取正文/建议/释义/汇率"""
import shlex
from pathlib import Path

from mcp import types
from mcp.server import Server

from _stdio_bridge import StdioBridge

MOUNT = "duck"
KEY_ENV = "DUCK_KEY"
DEFAULT_KEY = "wei123.."

DUCK_DIR = Path(__file__).resolve().parent.parent / "duck-mcp"

server = Server("duck-bridge")


def _params():
    import os

    from mcp.client.stdio import StdioServerParameters

    cmd = os.environ.get("DUCK_MCP_CMD", "bash")
    args = ["-c", f"cd {shlex.quote(str(DUCK_DIR))} && exec node dist/index.js"]
    return StdioServerParameters(command=cmd, args=args)


bridge = StdioBridge(_params, timeout=90.0)


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return await bridge.list_tools()


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    return await bridge.call_tool(name, arguments)
