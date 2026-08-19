"""豆包联网搜索 (web_search / web_search_image)。上游 key: VOLCENGINE_ARK_API_KEY"""
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
    """轻量有界化：web 结果删 Content（实测与 Summary 逐字相同，纯体积）。
    Summary 保持完整不截断；其余字段原样保留。image 结果不动。"""
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


async def doubao_web_search(query: str, count: int, search_type: str = "web", **extra) -> dict:
    if not ARK_KEY:
        raise HTTPException(500, "服务端未配置 VOLCENGINE_ARK_API_KEY")
    body = {"Query": query, "SearchType": search_type, "Count": count, **extra}
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            DOUBAO_HOST,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {ARK_KEY}",
                "X-Traffic-Tag": "ark_mcp_server_web_search",
            },
            json=body,
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
            description=(
                "豆包/火山引擎联网搜索（网页搜索）。返回 Result.WebResults[]，每条含 Title/Snippet/Summary/Url/PublishTime/AuthInfoDes。"
                "Content 与 Summary 相同已省略；需要全文时用 Url 自行抓取。"
                "高级参数：Sites 限定站点、BlockHosts 屏蔽站点、Industry 行业搜索(finance/game/health/gov)、"
                "AuthInfoLevel 权威等级、NeedContent 仅返回有正文、NeedUrl 强制有链接、QueryRewrite 开启改写。"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "Query": {"type": "string", "description": "搜索关键词，1~100 字符"},
                    "Count": {"type": "integer", "description": "返回条数，1~50，默认 10", "default": 10},
                    "TimeRange": {"type": "string", "description": "时间范围：OneDay/OneWeek/OneMonth/OneYear 或 YYYY-MM-DD..YYYY-MM-DD（可选）"},
                    "Sites": {"type": "string", "description": "限定搜索站点，多个用 | 分隔，最多 20 个，如 aliyun.com|mp.qq.com（可选）"},
                    "BlockHosts": {"type": "string", "description": "屏蔽站点，多个用 | 分隔，最多 5 个（可选）"},
                    "AuthInfoLevel": {"type": "integer", "description": "权威等级：0=不限(默认) / 1=仅非常权威", "default": 0},
                    "NeedContent": {"type": "boolean", "description": "是否仅返回有正文的结果，默认 false", "default": False},
                    "NeedUrl": {"type": "boolean", "description": "是否强制返回有 Url 的结果（滤掉如意结果），默认 false", "default": False},
                    "Industry": {"type": "string", "description": "行业搜索：finance(金融)/game(游戏)/health(健康)/gov(政务官方)（可选）"},
                    "QueryRewrite": {"type": "boolean", "description": "开启 Query 改写（增加搜索耗时），默认 false", "default": False},
                    "ContentFormats": {"type": "string", "description": "正文格式：text(默认)/markdown", "default": "text"},
                },
                "required": ["Query"],
            },
        ),
        types.Tool(
            name="web_search_image",
            description=(
                "豆包/火山引擎图片搜索（SearchType=image）。返回 Result.ImageResults[]，"
                "每条含 Image.Url(图片直链)/Width/Height/Shape，可过滤尺寸与形状。"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "Query": {"type": "string", "description": "搜索关键词，1~100 字符"},
                    "Count": {"type": "integer", "description": "返回图片数，1~5，默认 5", "default": 5},
                    "ImageWidthMin": {"type": "integer", "description": "最小宽度（可选）"},
                    "ImageHeightMin": {"type": "integer", "description": "最小高度（可选）"},
                    "ImageWidthMax": {"type": "integer", "description": "最大宽度（可选）"},
                    "ImageHeightMax": {"type": "integer", "description": "最大高度（可选）"},
                    "ImageShapes": {"type": "array", "items": {"type": "string"}, "description": "形状过滤：横长方形/竖长方形/方形（可选）"},
                    "QueryRewrite": {"type": "boolean", "description": "开启 Query 改写，默认 false", "default": False},
                },
                "required": ["Query"],
            },
        ),
    ]


@server.call_tool()
async def doubao_call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    args = arguments or {}
    q = str(args.get("Query", "")).strip()
    if not q:
        raise ValueError("Query 不能为空")

    if name == "web_search":
        count = min(max(int(args.get("Count", 10)), 1), 50)
        filt = {}
        for k, cast in (("NeedContent", bool), ("NeedUrl", bool), ("AuthInfoLevel", int)):
            if args.get(k) is not None:
                filt[k] = cast(args[k])
        if args.get("Sites"):
            filt["Sites"] = str(args["Sites"])
        if args.get("BlockHosts"):
            filt["BlockHosts"] = str(args["BlockHosts"])
        extra = {"Filter": filt} if filt else {}
        if args.get("Industry"):
            extra["Industry"] = str(args["Industry"])
        if args.get("QueryRewrite") is not None:
            extra["QueryControl"] = {"QueryRewrite": bool(args["QueryRewrite"])}
        if args.get("ContentFormats"):
            extra["ContentFormats"] = str(args["ContentFormats"])
        data = bound_doubao_result(await doubao_web_search(q, count, "web", NeedSummary=True, **extra))
    elif name == "web_search_image":
        count = min(max(int(args.get("Count", 5)), 1), 5)
        filt = {}
        for k in ("ImageWidthMin", "ImageHeightMin", "ImageWidthMax", "ImageHeightMax"):
            if args.get(k) is not None:
                filt[k] = int(args[k])
        if args.get("ImageShapes"):
            filt["ImageShapes"] = list(args["ImageShapes"])
        extra = {"Filter": filt} if filt else {}
        if args.get("QueryRewrite") is not None:
            extra["QueryControl"] = {"QueryRewrite": bool(args["QueryRewrite"])}
        data = await doubao_web_search(q, count, "image", **extra)
    else:
        raise ValueError(f"未知工具: {name}")

    return [types.TextContent(type="text", text=json.dumps(data, ensure_ascii=False))]
