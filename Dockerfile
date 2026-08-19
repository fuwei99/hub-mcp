# 镜像由 GitHub Actions 构建推 GHCR（fuwei99/hub-mcp），HF 只拉现成镜像
# 构建流水线见 .github/workflows/build.yml
#
# ⚠️ 为什么钉 digest 而不用 :latest —— HF 构建会缓存 latest 的旧 digest，
#    tag 不变就不重新拉层，导致代码改了线上却还是旧的（踩过两次）。
#    换镜像时改下面这行 digest 即可（Actions 日志或 ghcr manifest 里取）。
FROM ghcr.io/fuwei99/hub-mcp@sha256:0799864bf70b882892be90624094173ca96f026e4342424ff54a4a7d4f809189

EXPOSE 7860

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
