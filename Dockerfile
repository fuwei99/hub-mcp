FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Node 22（官方 tarball，python tarfile 解压，tar 包内自带执行位，不需要 xz-utils）
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

# 装 duck-mcp（TS 原版）依赖并构建出 dist/
RUN cd duck-mcp && npm install && npm run build

# academic-mcp（独立 venv 隔离依赖，避免 fastmcp 与 hub 的 mcp==1.2.0 冲突；stdio 子进程桥用）
RUN python3 -m venv /opt/academic-venv \
    && /opt/academic-venv/bin/pip install --no-cache-dir academic-mcp==0.1.7

EXPOSE 7860

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
