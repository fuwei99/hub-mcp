# ⚠️⚠️ 铁律：这个文件是 **GitHub 侧的完整构建定义**，绝对不能被 HF 版覆盖！
#
# HF Space 的 Dockerfile 内容是 `FROM ghcr.io/fuwei99/hub-mcp@sha256:...`（只拉现成镜像）。
# 如果那份内容被同步回 GitHub，Actions 就会「套娃构建」：
# 从上一版镜像原地转手重推，COPY 一步都不执行 → 镜像永远是旧代码，但构建显示 success。
# 已经栽过两次。workflow 里加了防呆检查，真犯了会直接构建失败。
#
# 正确姿势：改代码 → 只推 GitHub → Actions 构建 → HF 那边单独改它自己的 Dockerfile digest。
# 千万别在本地对这个文件执行 `git checkout origin/main -- Dockerfile`（origin 是 HF 时）。

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Node 22（官方 tarball，python tarfile 解压；bun 在 HF 构建环境 Permission denied）
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL -o /tmp/node.tar.xz https://nodejs.org/dist/v22.16.0/node-v22.16.0-linux-x64.tar.xz \
    && python3 -c "import tarfile; tarfile.open('/tmp/node.tar.xz', 'r:xz').extractall('/opt')" \
    && ln -sf /opt/node-v22.16.0-linux-x64/bin/node /usr/local/bin/node \
    && ln -sf /opt/node-v22.16.0-linux-x64/bin/npm /usr/local/bin/npm \
    && rm /tmp/node.tar.xz \
    && node --version && npm --version

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py ./
COPY mcps/ ./mcps/
COPY duck-mcp/ ./duck-mcp/

# 构建自检：桥的公共模块必须在（曾因缓存/套娃导致镜像里缺文件）
RUN test -f mcps/_stdio_bridge.py || (echo "!!! mcps/_stdio_bridge.py 缺失，COPY 没生效" && exit 1)

# 装 duck-mcp（TS 原版）依赖并构建出 dist/
RUN cd duck-mcp && npm install && npm run build \
    && test -f duck-mcp/dist/index.js || test -f dist/index.js || (cd /app/duck-mcp && ls dist | head)

# academic-mcp（独立 venv 隔离依赖）
# 坑：academic-mcp 0.1.7 会拉 mcp 2.0.0，但 fastmcp 要 mcp 1.x 的 McpError（2.0 改名 MCPError）；
#     且不会自动装 pydantic-settings。故显式锁 mcp<2.0 并补依赖。
RUN python3 -m venv /opt/academic-venv \
    && /opt/academic-venv/bin/pip install --no-cache-dir academic-mcp==0.1.7 pydantic-settings "mcp<2.0" \
    && /opt/academic-venv/bin/python -c "from fastmcp import FastMCP; from academic_mcp.__main__ import main; print('academic-mcp import OK')"

# academic-mcp 下载目录（默认 ./downloads）
ENV ACADEMIC_MCP_DOWNLOAD_PATH=/tmp/papers
RUN mkdir -p /tmp/papers

EXPOSE 7860

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
