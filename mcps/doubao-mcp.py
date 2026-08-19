"""豆包联网搜索 (web_search)。上游 key: VOLCENGINE_ARK_API_KEY"""
import json
import os

import httpx
from fastapi import HTTPException
from mcp import types
from mcp.server import Server

MOUNT = "doubao"
KEY_ENV = "DOUBAO_KEY"
DEFAULT_KEY = "wei123.."
SECRETS = {"ark": "VOLCENGINE_ARK_API_KEY"}

ARK_KEY = os.environ.get("VOLCENGINE_ARK_API_KEY", "").strip()
DOUBAO_HOST = "https://open.feedcoopapi.com/search_api/web_search"

server = Server("doubao-search")


def bound_doubao_result(data: dict) -> dict:
    """轻量有界化：删 Content（实测与 Summary 逐字相同，纯体积）。
    Summary 保持完整不截断；其余字段原样保留。"""
    if not isinstance(data, dict):
        return data
    res = data.get("Result")
    if isinstance(res, dict):
        wrs = res.get("WebResults")
        if isinstance(wrs, list):
            for w in wrs:
                if isinstance(w, dict):
                    w.pop("Content", None)   # == Summary，去掉纯重复
    return data


async def doubao_web_search(query: str, count: int) -> dict:
    if not ARK_KEY:
        raise HTTPException(500, "服务端未配置 VOLCENGINE_ARK_API_KEY")
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            DOUBAO_HOST,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {ARK_KEY}",
                "X-Traffic-Tag": "ark_mcp_server_web_search",
            },
            json={"Query": query, "SearchType": "web", "Count": count, "NeedSummary": True},
        )
        data = r.json()
        if r.status_code >= 400 or (isinstance(data, dict) and data.get("Code") not in (None, 0, "0")):
            raise HTTPException(r.status_code, f"豆包接口错误: {json.dumps(data, ensure_ascii=False)[:500]}")
        return data


@server.list_tools()
async def doubao_list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="web_search",
            description="豆包/火山引擎联网搜索（网页搜索）。返回 Result.WebResults[]，每条含 Title/Snippet/Summary/Url/PublishTime/AuthInfoDes。Content 与 Summary 相同已省略；需要全文时用 Url 自行抓取。",
            inputSchema={
                "type": "object",
                "properties": {
                    "Query": {"type": "string", "description": "搜索关键词，1~100 字符"},
                    "Count": {"type": "integer", "description": "返回条数，1~50，默认 10", "default": 10},
                    "TimeRange": {"type": "string", "description": "时间范围：OneDay/OneWeek/OneMonth/OneYear 或 YYYY-MM-DD..YYYY-MM-DD（可选）"},
                },
                "required": ["Query"],
            },
        )
    ]


@server.call_tool()
async def doubao_call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    if name != "web_search":
        raise ValueError(f"未知工具: {name}")
    args = arguments or {}
    q = str(args.get("Query", "")).strip()
    if not q:
        raise ValueError("Query 不能为空")
    count = min(max(int(args.get("Count", 10)), 1), 50)
    data = bound_doubao_result(await doubao_web_search(q, count))
    return [types.TextContent(type="text", text=json.dumps(data, ensure_ascii=False))]
