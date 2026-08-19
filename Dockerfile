FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

# bun（单二进制，python zipfile 解压，免 unzip）
RUN curl -fsSL -o /tmp/bun.zip https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64.zip \
    && python3 -m zipfile -e /tmp/bun.zip /opt/bun \
    && chmod +x /opt/bun/bun-linux-x64 \
    && ln -sf /opt/bun/bun-linux-x64 /usr/local/bin/bun \
    && rm /tmp/bun.zip \
    && bun --version

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py ./
COPY mcps/ ./mcps/
COPY duck-mcp/ ./duck-mcp/

# 装 duck-mcp（TS 原版）依赖，bun.lock 锁定
RUN cd duck-mcp && bun install --frozen-lockfile && rm -rf node_modules/.cache

EXPOSE 7860

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
