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
├── Dockerfile           ← ⚠️ GitHub 侧完整构建定义，与 HF 侧那份内容不同，见「构建部署链路」
├── requirements.txt
├── .github/workflows/build.yml   ← GHCR 镜像构建（含防套娃闸门）
├── duck-mcp/            ← duck-mcp TS 原版完整项目（npm install + tsc build 出 dist/）
└── mcps/
    ├── _ddg.py              ← 库：DDG 搜索/抓取实现（下划线开头，不加载为插件）
    ├── _stdio_bridge.py     ← 库：stdio 子进程桥公共实现（duck / academic 共用，见「踩坑档案 #1」）
    ├── doubao-mcp.py        → /doubao/sse    web_search
    ├── zhihu-mcp.py         → /zhihu/sse     zhihu_search / global_search / zhihu_ask / zhihu_trending
    ├── ddg-mcp.py           → /ddg/sse       search / scrape（旧版，已被 /duck 取代）
    │                          + REST: POST /ddg/search、/ddg/scrape（给 rikkahub 安卓端）
    ├── duck-mcp.py          → /duck/sse      桥：bash -c 'cd duck-mcp && node dist/index.js'
    └── academic-mcp.py      → /academic/sse  桥：/opt/academic-venv/bin/academic-mcp
```

### 子进程桥（duck / academic）

这两个不是自己实现的，而是把上游原版 MCP server 当**子进程**拉起来，用 stdio 跟它说话，
hub 只做协议转发（`tools/list`、`tools/call` 原样透传）：

- **duck**：上游是 TS 项目（VM 沙箱解 anti-bot challenge + Chrome134 TLS 指纹），
  移植成 Python 成本太高，整个项目塞进 `duck-mcp/`，镜像里用 node 22 跑 `dist/index.js`。
- **academic**：纯 Python，但依赖（fastmcp）跟 hub 的 `mcp==1.2.0` 打架，
  所以装在独立 venv `/opt/academic-venv` 里隔离。

公共实现在 `mcps/_stdio_bridge.py`，**每次调用起一条独立会话、用完即关**——
这不是偷懒，是被 anyio 逼的，原因见「踩坑档案 #1」，别去加 session 缓存。

## 端点

| MCP | SSE 端点 | 工具 |
|---|---|---|
| 豆包搜索 | `https://fluidgender159-hub-mcp.hf.space/doubao/sse` | `web_search_custom`（Custom版，web+image，支持站点限定/行业/权威等级等）/ `web_search_global`（Global版，图文混合，支持 pdf、ICP 限定、短边/宽高比过滤） |
| 知乎 | `https://fluidgender159-hub-mcp.hf.space/zhihu/sse` | `zhihu_search` / `global_search` / `zhihu_ask` / `zhihu_trending` |
| DuckDuckGo | `https://fluidgender159-hub-mcp.hf.space/ddg/sse` | `search` / `scrape`（旧版，刮 html，容易被 DDG 反爬卡） |
| DuckDuckGo(原版TS桥) | `https://fluidgender159-hub-mcp.hf.space/duck/sse` | `ddg_get_answer` / `ddg_search` / `ddg_search_news` / `ddg_search_images` / `ddg_search_videos` / `ddg_fetch_content` / `ddg_get_suggestions` / `ddg_get_definition` / `ddg_convert_currency`（hung319/duck-mcp 原版，node 子进程桥，VM 挑战解法 + Chrome134 TLS 指纹，抗反爬） |
| 学术论文 | `https://fluidgender159-hub-mcp.hf.space/academic/sse` | `paper_search` / `paper_download` / `paper_read`（nalkalin/academic-mcp，独立 venv 子进程桥，arXiv/PubMed/PMC/bioRxiv/medRxiv/Semantic Scholar/CrossRef/IACR/CORE 等 18 学术源，免 key） |

#### 端点实测状态（2026-08-20）

| 端点 | tools/list | 实际调用 | 备注 |
|---|---|---|---|
| `/doubao/sse` | ✅ | ✅ | 免费额度 Custom+Global 共用 500 次/月，别耗尽 |
| `/zhihu/sse` | ✅ | ✅ | |
| `/academic/sse` | ✅ 3 工具 | ✅ 真论文返回 | arXiv 走通，缺 key 的源（Scopus/WOS/CORE/IEEE…）只是警告不影响 |
| `/duck/sse` | ✅ 9 工具 | ⚠️ 桥通、上游被拦 | DDG 对 HF 数据中心 IP 返回 anti-bot challenge，**非代码问题**，要换 IP / 挂代理 |
| `/ddg/sse` | ✅ | ⚠️ | 旧版，反爬更容易死，留着给 REST 用，可考虑删 |

#### academic 的参数坑

`paper_search` / `paper_download` 收的是 **`query_list` 对象数组**，不是字符串：

```json
{"query_list": [{"query": "quantum computing", "searcher": "arxiv", "max_results": 2}]}
```

`searcher` 省略 = 搜全部源（慢）。`paper_read` 则是 `{"searcher": ..., "paper_id": ...}`。

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
| duck | `DUCK_KEY` | `wei123..` |
| academic | `ACADEMIC_KEY` | `wei123..` |

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

---

# 构建部署链路

HF Space 的构建环境限制多（bun 装不上、curl 都没有），所以**不在 HF 里构建**：

```
改代码 → push GitHub(fuwei99/hub-mcp) → Actions 构建镜像 → 推 GHCR
                                                              ↓
                                    HF 的 Dockerfile 只 FROM 拉现成镜像
```

两侧 `Dockerfile` **内容不同、各管一件事**：

| 位置 | 内容 | 作用 |
|---|---|---|
| GitHub `Dockerfile` | `FROM python:3.12-slim` + 装 node/venv + `COPY` | 真正构建镜像 |
| HF `Dockerfile` | `FROM ghcr.io/fuwei99/hub-mcp@sha256:...` | 只拉现成镜像跑 |

## 🚨 铁律

> **1. HF 那份 Dockerfile 绝对不能同步回 GitHub。**
> 否则 Actions 会「套娃构建」：从上一版镜像原地转手重推，`COPY` 一步都不执行，
> 镜像永远是旧代码，**构建却显示 success**。已栽两次（见踩坑档案 #2）。
> 具体地雷：本地仓库 remote 指向 HF 时，别对 Dockerfile 执行
> `git checkout origin/main -- Dockerfile`，会把 HF 版拉进本地再一起推去 GitHub。
>
> **2. HF 侧钉 digest，不要用 `:latest`。**
> HF 构建会缓存 latest 的旧 digest，tag 不变就不重新拉层 → 代码改了线上还是旧的。
>
> **3. 部署前先验货，别盲信 "success"。**
> 从 GHCR 把代码层掏出来看文件对不对（方法见下），比在线上日志里一次次撞墙快得多。

## 换镜像的标准流程

```bash
# 1. 改代码，只推 GitHub（注意：Dockerfile 必须是完整构建版）
git push --force https://github.com/fuwei99/hub-mcp.git main:main

# 2. 等 Actions（workflow 已带防呆闸门，套娃/缺 COPY 会直接 fail）
curl -H "Authorization: Bearer $GITHUB_TOKEN_FUWEI" \
  "https://api.github.com/repos/fuwei99/hub-mcp/actions/runs?per_page=1"

# 3. 取新 digest
tok=$(curl -s "https://ghcr.io/token?scope=repository:fuwei99/hub-mcp:pull" | jq -r .token)
curl -sI -H "Authorization: Bearer $tok" \
  -H "Accept: application/vnd.oci.image.index.v1+json" \
  "https://ghcr.io/v2/fuwei99/hub-mcp/manifests/latest" | grep -i docker-content-digest

# 4. 改 HF 的 Dockerfile FROM 行为该 digest，推 HF
# 5. 验证线上真的换了代码（找个只有新版才有的字符串）
curl -s https://fluidgender159-hub-mcp.hf.space/ | jq .about
```

### 验货：从 GHCR 掏文件看

不用 docker，纯 curl 就能把镜像层扒开（判断构建是否真生效的终极手段）：

```bash
tok=$(curl -s "https://ghcr.io/token?scope=repository:fuwei99/hub-mcp:pull" | jq -r .token)
A="Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json"
# index → amd64 manifest → 找几 KB 的小层（就是 COPY mcps/ 那层）→ 拉 blob 解 tar
curl -s -H "Authorization: Bearer $tok" -H "$A" \
  "https://ghcr.io/v2/fuwei99/hub-mcp/manifests/latest" -o idx.json
# ...取 amd64 digest、取 layers 里 size < 20000 的、curl blobs/<digest> | tar tz
```

Actions 日志里也能一眼看出套娃：正常构建有 `COPY`、跑 1~2 分钟；
套娃构建只有 `resolve ghcr.io/... done` + `exporting layers`，**2 秒完事**。

---

# 踩坑档案

## #1 ⭐ anyio cancel scope 不能跨 task（子进程桥卡死真因）

**现象**：`/duck/sse`、`/academic/sse` 连得上、`initialize` 秒回，但 `tools/list`
**永久静默** —— 不报错、不超时、SSE 里只有 ping。任何 MCP 客户端接上去都是"卡死"。

**误判过的方向**（都不是原因）：SSE 长连接、测试脚本、node 起不来、
banner 污染 stdout（banner 走的是 stderr，stdout 干净）。

**真因**：`stdio_client()` 和 `ClientSession()` 都是 **task-bound** 的 anyio 上下文。
桥当初为了省开销，在 A 请求的 task 里 `__aenter__` 后把 session 缓存到全局给 B 请求复用。
而 hub 里每个 SSE 连接是独立 task，于是：

```
RuntimeError: Attempted to exit cancel scope in a different task than it was entered in
```

表现极其阴险：`initialize` 能回是因为**那是桥壳自己答的，根本没碰子进程**；
一到 `tools/list` 需要真子进程转发，就死在跨 task 的 cancel scope 上。

**复现**（30 行本地脚本，不用部署）：

```python
async def task_a():
    cm = stdio_client(params); read, write = await cm.__aenter__()
    scm = ClientSession(read, write); s = await scm.__aenter__()
    await s.initialize(); state["s"] = s          # 缓存给别的 task

async def task_b():
    await state["s"].list_tools()                 # 💥 死这儿

await asyncio.create_task(task_a())
await asyncio.create_task(task_b())
```

**修复**：`mcps/_stdio_bridge.py` —— 每次 `list_tools`/`call_tool` 都在**当前 task 内**
开子进程、`async with` 闭合、用完即关；只缓存工具描述（纯数据，可跨 task）。

```python
async with stdio_client(self._params_factory()) as (read, write):
    async with ClientSession(read, write) as session:
        await asyncio.wait_for(session.initialize(), timeout=self._timeout)
        return await asyncio.wait_for(fn(session), timeout=self._timeout)
```

**别去"优化"成共享 session**。真要提速，正确做法是起一个专属长驻 worker task +
队列，所有 IO 都在那个 task 内做，而不是把上下文对象跨 task 传。

**顺带的教训**：`ClientSession(read, write)` 光 new 不 `__aenter__` 也会挂 ——
后台的「读 stdout → 派发响应」task 是在 `__aenter__` 里才启动的，
不进上下文就等于发出去的请求没人收回复。

## #2 ⭐ 套娃构建（镜像永远是旧代码，构建却 success）

**现象**：改完代码、Actions success、HF 重建 RUNNING，但线上行为一点没变。
反复怀疑 HF 缓存、GHCR 缓存、layer 缓存，全不是。

**定位手段**：从 GHCR 把 `COPY mcps/` 那层扒出来 `tar tzf` —— 发现新加的
`_stdio_bridge.py` **根本不在镜像里**，而 GitHub 上明明有。再看 Actions 日志：

```
#1 transferring dockerfile: 647B          ← 完整版有 2.7KB
#5 resolve ghcr.io/fuwei99/hub-mcp@sha256:0799864b... done
#7 exporting layers done                  ← 全程 2 秒，零 COPY
```

**真因**：GitHub 仓库里的 Dockerfile 变成了 HF 版的
`FROM ghcr.io/fuwei99/hub-mcp@sha256:...` —— Actions 拿旧镜像原地转手重推。

**怎么被搞进去的**：本地仓库 remote 是 HF，执行了
`git checkout origin/main -- Dockerfile` 把 HF 版拉进工作区，
之后 push GitHub 时一并带过去了。

**防呆**（已加进 `.github/workflows/build.yml`，再犯当场构建失败）：

```yaml
- name: 拒绝套娃构建
  run: |
    if grep -qE '^FROM +ghcr\.io/fuwei99/hub-mcp' Dockerfile; then
      echo "::error::Dockerfile 是 HF 版，会套娃构建"; exit 1
    fi
    grep -q 'COPY mcps/' Dockerfile || { echo "::error::缺少 COPY mcps/"; exit 1; }
```

另外 Dockerfile 里也加了构建期自检：`test -f mcps/_stdio_bridge.py || exit 1`。

## #3 academic-mcp 的依赖地狱

上游 `academic-mcp==0.1.7` 没锁依赖上限，装出来的组合是坏的。三连报错：

| 报错 | 原因 |
|---|---|
| `No module named 'pydantic_settings'` | fastmcp 需要它，但 academic-mcp 没声明 |
| `cannot import name 'McpError'`（提示 `Did you mean MCPError?`） | 拉到了 `mcp 2.0.0`，而 fastmcp 要 mcp 1.x 的 `McpError`（2.0 改名 `MCPError`） |
| `cannot import name 'FastMCP' from 'fastmcp' (unknown location)` | 分两步 `pip install -U fastmcp` 把包装成了空壳命名空间残包 |

**修复**：一条命令装齐、显式锁上限，并在构建期做 import 自检：

```dockerfile
RUN python3 -m venv /opt/academic-venv \
    && /opt/academic-venv/bin/pip install --no-cache-dir \
         academic-mcp==0.1.7 pydantic-settings "mcp<2.0" \
    && /opt/academic-venv/bin/python -c "from fastmcp import FastMCP; \
         from academic_mcp.__main__ import main; print('academic-mcp import OK')"
```

实测可用组合：`academic-mcp 0.1.7` + `fastmcp 3.4.7`（或 2.14.1）+ `mcp 1.29.0`
+ `pydantic-settings 2.15.0`。

**教训**：升级依赖别分两步 `pip install` 再 `pip install -U`，一次装齐让解析器统一决策；
依赖组合务必**本地 venv 实测**出来再写进 Dockerfile，并把 import 自检放进构建期 ——
装错就构建失败，而不是等线上日志报错。

## #4 其他

| 现象 | 原因 | 修复 |
|---|---|---|
| bun 下载 exit 127 | `python:3.12-slim` 没 curl | 先 `apt install curl` |
| bun `Permission denied` | HF 构建环境限制 | 换 Node 22 官方 tarball，`python tarfile` 解压（tar 内自带执行位，连 xz-utils 都不用装） |
| `stdio_client()` 报 env/args 错 | `mcp==1.2.0` 旧 API：只收一个 `StdioServerParameters` 对象 | 按旧签名传单参数 |
| academic 报 `FileNotFoundError: [Errno 2]` | `xlin.xmap_async` → `ProcessPoolExecutor` → `multiprocessing.Lock` 需要 `/dev/shm`；proot 沙箱里没有 | **纯本地环境限制，HF/docker 正常**。下载目录另设 `ACADEMIC_MCP_DOWNLOAD_PATH=/tmp/papers` |
| 本地/HF 远端分叉 | 两边并行推送 | rebase 后强推；或干净 clone 一份专门用于部署 |

## 排障方法论（省时间的部分）

1. **别用 Python MCP 客户端调试卡死问题** —— 它自己也会挂，看不出卡在哪。
   用 curl 手打协议，逐帧看谁不回话：

   ```bash
   curl -sN -H "Authorization: Bearer wei123.." "$BASE/duck/sse" > sse.log &
   SID=$(grep -o 'session_id=[a-f0-9]*' sse.log | head -1 | cut -d= -f2)
   P="$BASE/duck/messages/?session_id=$SID"
   curl -X POST "$P" -d '{"jsonrpc":"2.0","id":1,"method":"initialize",...}'
   curl -X POST "$P" -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
   curl -X POST "$P" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
   # 盯 sse.log：initialize 回了但 id:2 不回 → 问题在桥拉子进程那一步
   ```

2. **分层定位**：桥壳 → 子进程能否单独跑 → 子进程库函数直接调。
   本例中 `ArxivSearcher().search()` 直接调是好的，说明搜索本体没问题，锅在包装层。

3. **在线上日志里撞墙最贵**。能本地起 hub 复现的，绝不推线上试；
   依赖问题放进构建期自检，让它在 Actions 里就炸。

4. **`serverInfo.version` 不是代码版本**（那是 mcp 库版本）。判断线上是不是新代码，
   要找只有新版才有的字符串，比如 `GET /` 返回的 about 文案。
