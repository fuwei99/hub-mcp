"""豆包搜索 (web_search_custom / web_search_global)。上游 key: VOLCENGINE_ARK_API_KEY"""
import json
import os

import httpx
from fastapi import HTTPException
from mcp import types
from mcp.server import Server

MOUNT = "doubao"
KEY_ENV = "DOUBAO_KEY"
DEFAULT_KEY = "wei123.."
SECRETS = {"ark": "VOLCENGINE_ARK_API_KEY", "global": "VOLCENGINE_GLOBAL_API_KEY"}

ARK_KEY = os.environ.get("VOLCENGINE_ARK_API_KEY", "").strip()
GLOBAL_KEY = os.environ.get("VOLCENGINE_GLOBAL_API_KEY", "").strip() or ARK_KEY
CUSTOM_HOST = "https://open.feedcoopapi.com/search_api/web_search"
GLOBAL_HOST = "https://open.feedcoopapi.com/search_api/global_search"

server = Server("doubao-search")


def bound_doubao_result(data: dict) -> dict:
    """轻量有界化：Custom 版 web 结果删 Content（实测与 Summary 逐字相同，纯体积）。
    Summary 保持完整不截断；其余字段原样保留。image / Global 版结果不动。"""
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


async def ark_search(host: str, body: dict, key: str = "") -> dict:
    if not key:
        key = ARK_KEY
    if not key:
        raise HTTPException(500, "服务端未配置 VOLCENGINE_ARK_API_KEY")
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            host,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {key}",
                "X-Traffic-Tag": "ark_mcp_server_web_search",
            },
            json=body,
        )
        data = r.json()
        if r.status_code >= 400 or (isinstance(data, dict) and data.get("Code") not in (None, 0, "0")):
            raise HTTPException(r.status_code, f"豆包接口错误: {json.dumps(data, ensure_ascii=False)[:500]}")
        res = data.get("Result") if isinstance(data, dict) else None
        if isinstance(res, dict):
            ec = res.get("ErrorCode")
            if ec not in (None, 0):
                raise HTTPException(400, f"豆包接口错误 ErrorCode={ec}: {res.get('ErrorMsg', '')}")
        return data


@server.list_tools()
async def doubao_list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="web_search_custom",
            description=(
                "豆包搜索 Custom版（联网搜索，支持订阅套餐+按量后付费）。"
                "SearchType=web 返回 Result.WebResults[]（Title/Snippet/Summary/Url/PublishTime/AuthInfoDes，Content 与 Summary 相同已省略）；"
                "SearchType=image 返回 Result.ImageResults[]（图片直链+尺寸+形状）。"
                "高级参数：Sites 限定站点、BlockHosts 屏蔽站点、Industry 行业搜索(finance/game/health/gov)、"
                "AuthInfoLevel 权威等级、NeedContent 仅返回有正文、NeedUrl 强制有链接、QueryRewrite 开启改写。"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "Query": {"type": "string", "description": "搜索关键词，1~100 字符"},
                    "SearchType": {"type": "string", "description": "web=网页搜索(默认) / image=图片搜索", "default": "web"},
                    "Count": {"type": "integer", "description": "返回条数：web 1~50 默认10；image 1~5 默认5", "default": 10},
                    "TimeRange": {"type": "string", "description": "发文时间：OneDay/OneWeek/OneMonth/OneYear 或 YYYY-MM-DD..YYYY-MM-DD（仅 web，可选）"},
                    "Sites": {"type": "string", "description": "限定搜索站点，多个用 | 分隔，最多 20 个，如 aliyun.com|mp.qq.com（可选）"},
                    "BlockHosts": {"type": "string", "description": "屏蔽站点，多个用 | 分隔，最多 5 个（可选）"},
                    "AuthInfoLevel": {"type": "integer", "description": "权威等级：0=不限(默认) / 1=仅非常权威", "default": 0},
                    "NeedContent": {"type": "boolean", "description": "仅返回有正文的结果，默认 false", "default": False},
                    "NeedUrl": {"type": "boolean", "description": "强制返回有 Url 的结果（滤掉如意结果），默认 false", "default": False},
                    "Industry": {"type": "string", "description": "行业搜索：finance(金融)/game(游戏)/health(健康)/gov(政务官方)（仅 web，可选）"},
                    "QueryRewrite": {"type": "boolean", "description": "开启 Query 改写（增加搜索耗时），默认 false", "default": False},
                    "ContentFormats": {"type": "string", "description": "正文格式：text(默认)/markdown（仅 web，可选）", "default": "text"},
                    "ImageWidthMin": {"type": "integer", "description": "图片最小宽度（仅 image，可选）"},
                    "ImageHeightMin": {"type": "integer", "description": "图片最小高度（仅 image，可选）"},
                    "ImageWidthMax": {"type": "integer", "description": "图片最大宽度（仅 image，可选）"},
                    "ImageHeightMax": {"type": "integer", "description": "图片最大高度（仅 image，可选）"},
                    "ImageShapes": {"type": "array", "items": {"type": "string"}, "description": "形状过滤：横长方形/竖长方形/方形（仅 image，可选）"},
                },
                "required": ["Query"],
            },
        ),
        types.Tool(
            name="web_search_global",
            description=(
                "豆包搜索 Global版（仅按量后付费，免费额度与 Custom 版共用）。"
                "返回 Result.Documents[]，图文混合：每条含 Snippet[]（Type=text/image 混排）、"
                "DocumentInfo（字数/token/文件类型 webpage|pdf|image）、HostInfo（站点权威度）。"
                "SearchType=image 时文搜图，可按短边像素/宽高比过滤；Filter.IcpHostOnly 只搜国内 ICP 备案站点。"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "Query": {"type": "string", "description": "搜索关键词，1~100 字符"},
                    "SearchType": {"type": "string", "description": "web=文搜文(默认) / image=文搜图", "default": "web"},
                    "DocCount": {"type": "integer", "description": "返回条数，1~20，默认10", "default": 10},
                    "MaxSnippetLength": {"type": "integer", "description": "单个摘要片段最大 tokens，最大3000，推荐1000以内（>0 生效）", "default": 500},
                    "MaxImageCountPerDoc": {"type": "integer", "description": "单条结果最多返回图片数，1~10，默认3（仅 web，>0 生效）", "default": 3},
                    "IcpHostOnly": {"type": "boolean", "description": "仅在国内 ICP 备案网站中搜索，默认 false", "default": False},
                    "ShortEdgePixelMin": {"type": "integer", "description": "图片短边下限 min(width,height)（仅 image，可选）"},
                    "ShortEdgePixelMax": {"type": "integer", "description": "图片短边上限（仅 image，可选）"},
                    "AspectRatioMin": {"type": "number", "description": "图片宽高比下限 height/width（仅 image，可选）"},
                    "AspectRatioMax": {"type": "number", "description": "图片宽高比上限 height/width（仅 image，可选）"},
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
    st = str(args.get("SearchType", "web")).strip().lower()
    if st not in ("web", "image"):
        raise ValueError("SearchType 只能为 web 或 image")

    if name == "web_search_custom":
        count = min(max(int(args.get("Count", 10)), 1), 50 if st == "web" else 5)
        filt = {}
        for k, cast in (("NeedContent", bool), ("NeedUrl", bool), ("AuthInfoLevel", int)):
            if args.get(k) is not None:
                filt[k] = cast(args[k])
        for k in ("ImageWidthMin", "ImageHeightMin", "ImageWidthMax", "ImageHeightMax"):
            if args.get(k) is not None:
                filt[k] = int(args[k])
        if args.get("ImageShapes"):
            filt["ImageShapes"] = list(args["ImageShapes"])
        if args.get("Sites"):
            filt["Sites"] = str(args["Sites"])
        if args.get("BlockHosts"):
            filt["BlockHosts"] = str(args["BlockHosts"])
        extra = {"Filter": filt} if filt else {}
        if st == "web":
            extra["NeedSummary"] = True
            if args.get("TimeRange"):
                extra["TimeRange"] = str(args["TimeRange"])
            if args.get("Industry"):
                extra["Industry"] = str(args["Industry"])
            if args.get("ContentFormats"):
                extra["ContentFormats"] = str(args["ContentFormats"])
        if args.get("QueryRewrite") is not None:
            extra["QueryControl"] = {"QueryRewrite": bool(args["QueryRewrite"])}
        data = bound_doubao_result(
            await ark_search(CUSTOM_HOST, {"Query": q, "SearchType": st, "Count": count, **extra})
        )
    elif name == "web_search_global":
        body = {"Query": q, "SearchType": st, "DocCount": min(max(int(args.get("DocCount", 10)), 1), 20)}
        if args.get("MaxSnippetLength") is not None:
            body["MaxSnippetLength"] = min(max(int(args["MaxSnippetLength"]), 1), 3000)
        if args.get("MaxImageCountPerDoc") is not None:
            body["MaxImageCountPerDoc"] = min(max(int(args["MaxImageCountPerDoc"]), 1), 10)
        if args.get("IcpHostOnly") is not None:
            body["Filter"] = {"IcpHostOnly": bool(args["IcpHostOnly"])}
        imgf = {}
        for k in ("ShortEdgePixelMin", "ShortEdgePixelMax"):
            if args.get(k) is not None:
                imgf[k] = int(args[k])
        for k in ("AspectRatioMin", "AspectRatioMax"):
            if args.get(k) is not None:
                imgf[k] = float(args[k])
        if imgf:
            body["ImageFilter"] = imgf
        data = await ark_search(GLOBAL_HOST, body, GLOBAL_KEY)
    else:
        raise ValueError(f"未知工具: {name}")

    return [types.TextContent(type="text", text=json.dumps(data, ensure_ascii=False))]
