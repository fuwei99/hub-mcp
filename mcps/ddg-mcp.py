"""DuckDuckGo 搜索/抓取 (search / scrape)，无上游 key。自带 REST: POST /ddg/search、/ddg/scrape（给 rikkahub 安卓端）"""
import json

import _ddg as ddg
from mcp import types
from mcp.server import Server
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

MOUNT = "ddg"
KEY_ENV = "DDG_KEY"
DEFAULT_KEY = "wei123.."

server = Server("ddg-search")


@server.list_tools()
async def ddg_list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="search",
            description=(
                "DuckDuckGo 网页搜索（无需 API key）。返回 items[]，每条含 title / url / text(摘要)。"
                "摘要不够用时把 url 丢给 scrape 取正文。DDG 有反爬限流，请勿高频连打。"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词，需短于 500 字符"},
                    "count": {"type": "integer", "description": "返回条数，1~30，默认 10", "default": 10},
                    "region": {"type": "string", "description": "地区代码：auto(默认) / wt-wt(全球) / cn-zh / us-en 等", "default": "auto"},
                    "time_range": {"type": "string", "description": "时间范围：all(默认) / d(天) / w(周) / m(月) / y(年)", "default": "all"},
                    "safe_search": {"type": "string", "description": "off / moderate(默认) / strict", "default": "moderate"},
                },
                "required": ["query"],
            },
        ),
        types.Tool(
            name="scrape",
            description="抓取任意网页正文（剔除 script/style/nav/footer 等噪音后返回纯文本 + title/description/language）。",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "要抓取的网址"},
                    "max_length": {"type": "integer", "description": "正文长度上限，500~40000，默认 8000", "default": 8000},
                },
                "required": ["url"],
            },
        ),
    ]


@server.call_tool()
async def ddg_call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    args = arguments or {}
    try:
        if name == "search":
            data = await ddg.search(
                query=str(args.get("query", "")),
                count=int(args.get("count", 10)),
                region=str(args.get("region", "auto")),
                time_range=str(args.get("time_range", "all")),
                safe_search=str(args.get("safe_search", "moderate")),
            )
        elif name == "scrape":
            data = await ddg.scrape(
                url=str(args.get("url", "")),
                max_length=int(args.get("max_length", ddg.MAX_SCRAPE_LENGTH)),
            )
        else:
            raise ValueError(f"未知工具: {name}")
    except ddg.DDGError as e:
        raise ValueError(str(e))
    return [types.TextContent(type="text", text=json.dumps(data, ensure_ascii=False, indent=2))]


async def ddg_rest_search(request: Request):
    body = await request.json() if await request.body() else {}
    if not isinstance(body, dict):
        return JSONResponse({"detail": "body 必须是 JSON 对象"}, status_code=400)
    try:
        data = await ddg.search(
            query=str(body.get("query", "")),
            count=int(body.get("count", 10)),
            region=str(body.get("region", "auto")),
            time_range=str(body.get("time_range", "all")),
            safe_search=str(body.get("safe_search", "moderate")),
        )
    except ddg.DDGError as e:
        return JSONResponse({"detail": str(e)}, status_code=502)
    return JSONResponse({"items": data["items"], "images": data.get("images", [])})


async def ddg_rest_scrape(request: Request):
    body = await request.json() if await request.body() else {}
    if not isinstance(body, dict):
        return JSONResponse({"detail": "body 必须是 JSON 对象"}, status_code=400)
    try:
        data = await ddg.scrape(
            url=str(body.get("url", "")),
            max_length=int(body.get("max_length", ddg.MAX_SCRAPE_LENGTH)),
        )
    except ddg.DDGError as e:
        return JSONResponse({"detail": str(e)}, status_code=502)
    return JSONResponse({"urls": data["urls"]})


ROUTES = [
    Route("/search", endpoint=ddg_rest_search, methods=["POST"]),
    Route("/scrape", endpoint=ddg_rest_scrape, methods=["POST"]),
]
