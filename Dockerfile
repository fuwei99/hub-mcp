# 镜像由 GitHub Actions 构建推 GHCR（fuwei99/hub-mcp），HF 只拉现成镜像
# 构建流水线见 .github/workflows/build.yml
# 明确指向包含 fix 的镜像 tag，强制 HF 拉取新镜像
FROM ghcr.io/fuwei99/hub-mcp:24e6392caef40d4bdd47872babc9d265d1d8d5eb

EXPOSE 7860

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
