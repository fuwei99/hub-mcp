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

## 鉴权

每个 MCP 独立 Bearer key（`Authorization: Bearer <key>`）：

| MCP | key | 当前值 |
|---|---|---|
| doubao | `DOUBAO_KEY` env | `wei123..` |
| zhihu | `ZHIHU_KEY` env | `wei123..` |

> key 可通过 Space Secrets 覆盖（同名 env）。

## 上游密钥（Space Settings → Secrets，勿写进仓库）

| 名称 | 说明 |
|---|---|
| `ASK_ECHO_SEARCH_INFINITY_API_KEY` | 火山方舟豆包搜索 API key |
| `ZHIHU_ACCESS_SECRET` | 知乎开放平台 Access Secret |

## 扩展新 MCP

照 `hub_server.py` 里的 doubao/zhihu 模板：
1. 新建一个 `Server("xxx")` + list_tools/call_tool
2. 加 `SseServerTransport("/xxx/messages/")` + `/xxx/sse` 路由
3. 中间件里加 `xxx` 的鉴权分支（`XXX_KEY` env）
