# 镜像由 GitHub Actions 构建推 GHCR（fuwei99/hub-mcp），HF 只拉现成镜像
# 构建流水线见 .github/workflows/build.yml
# 指向验证过的镜像 tag：__aenter__ 修复 + node + academic-venv
FROM ghcr.io/fuwei99/hub-mcp:1938412a0394724a304135060c63ef4d2ebd9fca

EXPOSE 7860

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
