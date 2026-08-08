#!/usr/bin/env python3
"""
MCP Hub — 一个 HF Space 挂多个 MCP Server
=========================================
路径路由（每个 MCP 独立 SSE 端点 + 独立鉴权 key）:
    /doubao/sse          → 豆包联网搜索 (web_search)
    /zhihu/sse           → 知乎 MCP (zhihu_search / global_search / zhihu_ask / zhihu_trending)

鉴权（Bearer token，SSE 握手与消息 POST 都验）:
    DOUBAO_KEY   env 可覆盖，默认 wei123..
    ZHIHU_KEY    env 可覆盖，默认 wei123..

上游密钥（放 HF Space Settings → Secrets，勿写进仓库）:
    ASK_ECHO_SEARCH_INFINITY_API_KEY   火山方舟豆包搜索 API key
    ZHIHU_ACCESS_SECRET                知乎开放平台 Access Secret

扩展新 MCP: 照 doubao/zhihu 的模板加一个 server + SSE 路由 + 中间件分支即可。
"""
import os
import json
import time
import httpx

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse

from mcp.server import Server
from mcp.server.sse import SseServerTransport
from mcp import types
from starlette.routing import Route, Mount

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
DOUBAO_KEY = os.environ.get("DOUBAO_KEY", "wei123..").strip()
ZHIHU_KEY = os.environ.get("ZHIHU_KEY", "wei123..").strip()
ARK_KEY = os.environ.get("ASK_ECHO_SEARCH_INFINITY_API_KEY", "").strip()
ZHIHU_SECRET = os.environ.get("ZHIHU_ACCESS_SECRET", "").strip()

app = FastAPI(title="MCP Hub", version="2.0.0")


def check_key(authorization, expected: str):
    if not expected:
        return  # 未配置 key = 不鉴权（不推荐）
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "缺少 Authorization: Bearer <key>")
    if authorization.split(" ", 1)[1].strip() != expected:
        raise HTTPException(403, "访问 key 错误")


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    try:
        if path.startswith("/doubao"):
            check_key(request.headers.get("authorization"), DOUBAO_KEY)
        elif path.startswith("/zhihu"):
            check_key(request.headers.get("authorization"), ZHIHU_KEY)
    except HTTPException as e:
        return JSONResponse({"error": e.detail}, status_code=e.status_code)
    return await call_next(request)


@app.get("/")
def root():
    return {
        "service": "MCP Hub",
        "endpoints": {
            "doubao": "/doubao/sse  (web_search)",
            "zhihu": "/zhihu/sse  (zhihu_search / global_search / zhihu_ask / zhihu_trending)",
        },
        "auth": {
            "doubao": "Bearer <DOUBAO_KEY>" if DOUBAO_KEY else "未配置",
            "zhihu": "Bearer <ZHIHU_KEY>" if ZHIHU_KEY else "未配置",
        },
        "upstream_configured": {
            "ark": bool(ARK_KEY),
            "zhihu": bool(ZHIHU_SECRET),
        },
    }


# ---------------------------------------------------------------------------
# doubao: 豆包联网搜索（直连火山 feedcoopapi）
# ---------------------------------------------------------------------------
DOUBAO_HOST = "https://open.feedcoopapi.com/search_api/web_search"


async def doubao_web_search(query: str, count: int) -> dict:
    if not ARK_KEY:
        raise HTTPException(500, "服务端未配置 ASK_ECHO_SEARCH_INFINITY_API_KEY")
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


doubao_server = Server("doubao-search")


@doubao_server.list_tools()
async def doubao_list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="web_search",
            description="豆包/火山引擎联网搜索（网页搜索）。返回 Result.WebResults[]，每条含 Title/Snippet/Summary/Url/PublishTime/AuthInfoDes。",
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


@doubao_server.call_tool()
async def doubao_call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    if name != "web_search":
        raise ValueError(f"未知工具: {name}")
    args = arguments or {}
    q = str(args.get("Query", "")).strip()
    if not q:
        raise ValueError("Query 不能为空")
    count = min(max(int(args.get("Count", 10)), 1), 50)
    data = await doubao_web_search(q, count)
    return [types.TextContent(type="text", text=json.dumps(data, ensure_ascii=False))]


# ---------------------------------------------------------------------------
# zhihu: 知乎开放平台 MCP（迁移自 hf-proxy，仅保留 MCP 部分）
# ---------------------------------------------------------------------------
ZHIHU_CONTENT = "https://developer.zhihu.com/api/v1/content"
ZHIHU_CHAT = "https://developer.zhihu.com/v1/chat/completions"


def zhihu_headers() -> dict:
    if not ZHIHU_SECRET:
        raise HTTPException(500, "服务端未配置 ZHIHU_ACCESS_SECRET")
    return {
        "Authorization": f"Bearer {ZHIHU_SECRET}",
        "X-Request-Timestamp": str(int(time.time())),
        "Content-Type": "application/json",
    }


def zhihu_parse(r: httpx.Response) -> dict:
    try:
        data = r.json()
    except Exception:
        raise HTTPException(r.status_code, f"知乎返回非 JSON: {r.text[:500]}")
    if r.status_code >= 400:
        raise HTTPException(r.status_code, f"知乎接口错误: {json.dumps(data, ensure_ascii=False)[:500]}")
    if isinstance(data, dict) and data.get("Code") not in (None, 0):
        raise HTTPException(400, f"知乎业务错误 Code={data.get('Code')}: {data.get('Message')}")
    return data


async def zhihu_get(endpoint: str, params: dict) -> dict:
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.get(f"{ZHIHU_CONTENT}/{endpoint}", params=params, headers=zhihu_headers())
        return zhihu_parse(r)


async def zhihu_chat(query: str, model: str) -> dict:
    body = {"model": model, "messages": [{"role": "user", "content": query}], "stream": False}
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(ZHIHU_CHAT, json=body, headers=zhihu_headers())
        return zhihu_parse(r)


zhihu_server = Server("zhihu-mcp")


@zhihu_server.list_tools()
async def zhihu_list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="zhihu_search",
            description="在知乎站内搜索问题、回答、文章。适合查中文社区的经验、观点、科普。",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "count": {"type": "integer", "description": "返回数量, 最大 10", "default": 10},
                },
                "required": ["query"],
            },
        ),
        types.Tool(
            name="global_search",
            description="全网搜索, 返回互联网公开网页结果。适合查实时信息、非知乎内容。",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "count": {"type": "integer", "description": "返回数量, 最大 20", "default": 10},
                },
                "required": ["query"],
            },
        ),
        types.Tool(
            name="zhihu_ask",
            description="知乎直答 (AI 问答), 直接给出对某个问题的综合回答。",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "要问的问题"},
                    "model": {"type": "string", "description": "模型档位: zhida-fast-1p5/zhida-thinking-1p5/zhida-agent", "default": "zhida-thinking-1p5"},
                },
                "required": ["query"],
            },
        ),
        types.Tool(
            name="zhihu_trending",
            description="获取知乎实时热榜, 了解当前热门话题。",
            inputSchema={
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "返回数量, 最大 30", "default": 30},
                },
            },
        ),
    ]


@zhihu_server.call_tool()
async def zhihu_call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    args = arguments or {}
    q = str(args.get("query", ""))
    if name == "zhihu_search":
        data = await zhihu_get("zhihu_search", {"Query": q, "Count": min(int(args.get("count", 10)), 10)})
    elif name == "global_search":
        data = await zhihu_get("global_search", {"Query": q, "Count": min(int(args.get("count", 10)), 20), "SearchDB": "all"})
    elif name == "zhihu_ask":
        data = await zhihu_chat(q, str(args.get("model", "zhida-thinking-1p5")))
    elif name == "zhihu_trending":
        data = await zhihu_get("hot_list", {"Limit": min(int(args.get("limit", 30)), 30)})
    else:
        raise ValueError(f"未知工具: {name}")
    return [types.TextContent(type="text", text=json.dumps(data, ensure_ascii=False, indent=2))]


# ---------------------------------------------------------------------------
# SSE 路由
# ---------------------------------------------------------------------------
doubao_sse = SseServerTransport("/doubao/messages/")
zhihu_sse = SseServerTransport("/zhihu/messages/")


async def handle_doubao_sse(request: Request):
    async with doubao_sse.connect_sse(
        request.scope, request.receive, request._send
    ) as streams:
        await doubao_server.run(*streams, doubao_server.create_initialization_options())


async def handle_zhihu_sse(request: Request):
    async with zhihu_sse.connect_sse(
        request.scope, request.receive, request._send
    ) as streams:
        await zhihu_server.run(*streams, zhihu_server.create_initialization_options())


app.router.routes.append(Route("/doubao/sse", endpoint=handle_doubao_sse))
app.router.routes.append(Mount("/doubao/messages/", app=doubao_sse.handle_post_message))
app.router.routes.append(Route("/zhihu/sse", endpoint=handle_zhihu_sse))
app.router.routes.append(Mount("/zhihu/messages/", app=zhihu_sse.handle_post_message))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 7860)))
