---
title: Pioneer
emoji: 🔥
colorFrom: purple
colorTo: pink
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# MCP Hub

一个 HF Space 挂多个 MCP Server，路径区分，各自独立鉴权 key。

## 端点

| MCP | SSE 端点 | 工具 |
|---|---|---|
| 豆包搜索 | `https://fluidgender159-hub-mcp.hf.space/doubao/sse` | `web_search` |
| 知乎 | `https://fluidgender159-hub-mcp.hf.space/zhihu/sse` | `zhihu_search` / `global_search` / `zhihu_ask` / `zhihu_trending` |
| DuckDuckGo | `https://fluidgender159-hub-mcp.hf.space/ddg/sse` | `search` / `scrape` |

## 鉴权

每个 MCP 独立 Bearer key（`Authorization: Bearer <key>`）：

| MCP | key | 当前值 |
|---|---|---|
| doubao | `DOUBAO_KEY` env | `wei123..` |
| zhihu | `ZHIHU_KEY` env | `wei123..` |
| ddg | `DDG_KEY` env | `wei123..` |

> key 可通过 Space Secrets 覆盖（同名 env）。

## 上游密钥（Space Settings → Secrets，勿写进仓库）

| 名称 | 说明 |
|---|---|
| `ASK_ECHO_SEARCH_INFINITY_API_KEY` | 火山方舟豆包搜索 API key |
| `ZHIHU_ACCESS_SECRET` | 知乎开放平台 Access Secret |

> DuckDuckGo 不需要任何上游密钥。

## DuckDuckGo 实现备注（`ddg.py`）

逻辑照抄 rikkahub 的 `search/.../DuckDuckGoSearchService.kt`，但有几个服务端特有的坑：

1. **必须用 `curl_cffi` + `impersonate="chrome131"`**。DDG 现在按 TLS/JA3 指纹拦人，
   `httpx` / `requests` 无论 header 怎么伪装都是 100% 吃 `202` + 选鸭子 CAPTCHA。
   安卓端 OkHttp 的指纹天生像浏览器，所以 app 里没这毛病。
2. **每次请求新连接**。实测复用 `Session` 命中率反而暴跌（第二发就 202）。
3. `html.duckduckgo.com/html/` 为主，失败时 fallback 到 `lite.duckduckgo.com/lite/`（另一套 table 解析器）。
4. 全局串行 + 最小间隔 9s + 三轮指数退避。机房 IP 比手机更容易被限流，别高频连打。

## 扩展新 MCP

照 `hub_server.py` 里的 doubao/zhihu 模板：
1. 新建一个 `Server("xxx")` + list_tools/call_tool
2. 加 `SseServerTransport("/xxx/messages/")` + `/xxx/sse` 路由
3. 中间件里加 `xxx` 的鉴权分支（`XXX_KEY` env）
