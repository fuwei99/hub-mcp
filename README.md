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
按 local-mcp-hub 的插件玩法重构：**一个 MCP 一个 py**，`main.py` 自动发现装配，加新 MCP 不用改主文件。

## 结构

```
hub-mcp/
├── main.py              ← 插件自动发现 + 鉴权壳 + 路由装配
├── Dockerfile
├── requirements.txt
└── mcps/
    ├── _ddg.py              ← 库：DDG 搜索/抓取实现（下划线开头，不加载为插件）
    ├── doubao-mcp.py        → /doubao/sse    web_search
    ├── zhihu-mcp.py         → /zhihu/sse     zhihu_search / global_search / zhihu_ask / zhihu_trending
    └── ddg-mcp.py           → /ddg/sse       search / scrape
                              + REST: POST /ddg/search、/ddg/scrape（给 rikkahub 安卓端）
```

## 端点

| MCP | SSE 端点 | 工具 |
|---|---|---|
| 豆包搜索 | `https://fluidgender159-hub-mcp.hf.space/doubao/sse` | `web_search_custom`（Custom版，web+image，支持站点限定/行业/权威等级等）/ `web_search_global`（Global版，图文混合，支持 pdf、ICP 限定、短边/宽高比过滤） |
| 知乎 | `https://fluidgender159-hub-mcp.hf.space/zhihu/sse` | `zhihu_search` / `global_search` / `zhihu_ask` / `zhihu_trending` |
| DuckDuckGo | `https://fluidgender159-hub-mcp.hf.space/ddg/sse` | `search` / `scrape`（旧版，刮 html，容易被 DDG 反爬卡） |
| DuckDuckGo(原版TS桥) | `https://fluidgender159-hub-mcp.hf.space/duck/sse` | `ddg_get_answer` / `ddg_search` / `ddg_search_news` / `ddg_search_images` / `ddg_search_videos` / `ddg_fetch_content` / `ddg_get_suggestions` / `ddg_get_definition` / `ddg_convert_currency`（hung319/duck-mcp 原版，node 子进程桥，VM 挑战解法 + Chrome134 TLS 指纹，抗反爬） |
| 学术论文 | `https://fluidgender159-hub-mcp.hf.space/academic/sse` | `paper_search` / `paper_download` / `paper_read`（nalkalin/academic-mcp，独立 venv 子进程桥，arXiv/PubMed/PMC/bioRxiv/Semantic Scholar/CrossRef/CORE 等 19+ 学术源，免 key） |

### REST 端点（给 rikkahub 安卓端，非 MCP）

| 方法 | 路径 | body | 返回 |
|---|---|---|---|
| POST | `/ddg/search` | `{query, count?, region?, time_range?, safe_search?}` | `{items:[{title,url,text}], images:[]}` |
| POST | `/ddg/scrape` | `{url, max_length?}` | `{urls:[{url,content,metadata:{...}}]}` |

返回体与 rikkahub 的 `SearchResult` / `ScrapedResult` 完全同构，客户端直接反序列化即可。
鉴权同为 `Authorization: Bearer <DDG_KEY>`，出错返回 `{"detail": "..."}`。

## 鉴权

每个 MCP 独立 Bearer key（`Authorization: Bearer <key>`）：

| MCP | key env | 默认值 |
|---|---|---|
| doubao | `DOUBAO_KEY` | `wei123..` |
| zhihu | `ZHIHU_KEY` | `wei123..` |
| ddg | `DDG_KEY` | `wei123..` |

env 配置了就用 env 值，没配用默认。`GET /` 首页可看各端点鉴权是否配置、上游 secret 有没有就位。

## 上游 Secrets（放 HF Space Settings → Secrets，勿写进仓库）

| env | 用途 |
|---|---|
| `VOLCENGINE_ARK_API_KEY` | 火山方舟豆包搜索 Custom 版 API key（必配，Global 版未配时回落用它） |
| `VOLCENGINE_GLOBAL_API_KEY` | 豆包搜索 Global 版专用 key（可选，去「API Key管理-按量后付费」创建，不配则 Global 版会用 ARK key 并大概率报 700901） |
| `ZHIHU_ACCESS_SECRET` | 知乎开放平台 Access Secret |

## 加一个新 MCP

往 `mcps/` 丢个 py，**main.py 不用改**：

```python
"""第一行 docstring 会显示在 / 首页 about 里。"""
import os
from mcp import types
from mcp.server import Server

MOUNT = "myname"          # 可选，默认用文件名（去掉 .py）
KEY_ENV = "MY_KEY"        # 可选，Bearer 鉴权 env 名
DEFAULT_KEY = ""          # 可选，默认 key（env 没配时用）
# ENABLED = False         # 可选，临时停用

server = Server("My Server")


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    ...


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    ...
```

- **不要**写 `if __name__ == "__main__": server.run(...)`——端口和路由归 hub 管。
- 一个 py 想挂多个端点：`MOUNTS = {"path1": srv1, "path2": srv2}`。
- 想带额外 REST 路由（单挂载）：`ROUTES = [starlette.Route("/xxx", endpoint=..., methods=["POST"])]`，会挂在本插件路径下。
- 想引用同目录库文件：`import _xxx`（下划线开头的文件不会被当插件加载）。
- 单个插件 import 失败只会在 `/` 的 `broken` 里报错，不影响其他插件。

## 本地跑

```bash
pip install -r requirements.txt
uvicorn main:app --port 7860
```
