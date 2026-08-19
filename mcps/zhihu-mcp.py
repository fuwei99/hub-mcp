"""知乎开放平台 MCP：zhihu_search / global_search / zhihu_ask / zhihu_trending。上游 key: ZHIHU_ACCESS_SECRET"""
import json
import os
import time

import httpx
from fastapi import HTTPException
from mcp import types
from mcp.server import Server

MOUNT = "zhihu"
KEY_ENV = "ZHIHU_KEY"
DEFAULT_KEY = "wei123.."
SECRETS = {"zhihu": "ZHIHU_ACCESS_SECRET"}

ZHIHU_SECRET = os.environ.get("ZHIHU_ACCESS_SECRET", "").strip()
ZHIHU_CONTENT = "https://developer.zhihu.com/api/v1/content"
ZHIHU_CHAT = "https://developer.zhihu.com/v1/chat/completions"

server = Server("zhihu-mcp")


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


@server.list_tools()
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


@server.call_tool()
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
