#!/usr/bin/env python3
"""
DuckDuckGo 搜索 / 抓取（Python 移植版）
=====================================
逻辑照抄 rikkahub 的 search/src/main/java/me/rerere/search/DuckDuckGoSearchService.kt：

- 无 API Key，POST html.duckduckgo.com/html/ 表单，第一页不需要 vqd
- kl = 地区（auto 留空交给 DDG 判断，wt-wt 全球），df = 时间范围（d/w/m/y）
- 结果链接可能被包成 /l/?uddg=<encoded>，需要 urldecode 还原
- 广告统一走 y.js，直接跳过
- CAPTCHA / anomaly 页面单独识别，报可读错误
- 滑动窗口限流

⚠️ 与 Kotlin 版的关键差异（踩坑记录）：
1. **必须用 curl_cffi 而非 httpx/requests**。DDG 现在按 TLS/JA3 指纹拦人：
   同样的 header，httpx 和 requests 100% 吃 202 + 选鸭子 CAPTCHA，
   curl_cffi 的 impersonate="chrome131" 才放行。安卓端 OkHttp 指纹天生像浏览器所以没这问题。
2. 加了 lite.duckduckgo.com/lite/ 作为 fallback（table 布局，另一套解析器）。
3. 加了指数退避重试 —— 机房 IP 比手机更容易撞 202，单发失败重试一次往往就过了。
4. 全局串行 + 最小请求间隔：并发打 DDG 是自杀行为。
"""
from __future__ import annotations

import asyncio
import random
import re
import time
from collections import deque
from urllib.parse import unquote

from bs4 import BeautifulSoup
from curl_cffi import requests as cffi

HTML_ENDPOINT = "https://html.duckduckgo.com/html/"
LITE_ENDPOINT = "https://lite.duckduckgo.com/lite/"

IMPERSONATE = "chrome131"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

MAX_SCRAPE_LENGTH = 8000
NOISE_TAGS = ("script", "style", "noscript", "nav", "header", "footer", "aside", "iframe", "svg")
_WS = re.compile(r"\s+")

# 实测 ~12s 间隔稳定，低于 8s 开始零星吃 202
MIN_INTERVAL = 9.0
MAX_ATTEMPTS = 3


class DDGError(RuntimeError):
    """DDG 侧的可读错误（上游拒绝 / 反爬 / 无结果）"""


class Throttle:
    """滑动窗口 + 最小间隔，全局串行。DDG 对突发请求极其敏感。"""

    def __init__(self, rpm: int, min_interval: float = 0.0):
        self.rpm = rpm
        self.min_interval = min_interval
        self._lock = asyncio.Lock()
        self._ts: deque[float] = deque()
        self._last = 0.0

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = time.monotonic()
                while self._ts and now - self._ts[0] >= 60.0:
                    self._ts.popleft()
                wait = 0.0
                if len(self._ts) >= self.rpm:
                    wait = max(wait, 60.0 - (now - self._ts[0]))
                if self.min_interval:
                    wait = max(wait, self.min_interval - (now - self._last))
                if wait <= 0:
                    self._ts.append(now)
                    self._last = now
                    return
                await asyncio.sleep(wait)  # 持锁等待 = 强制串行


search_throttle = Throttle(rpm=30, min_interval=MIN_INTERVAL)
scrape_throttle = Throttle(rpm=20, min_interval=1.0)


def _unwrap_redirect(url: str) -> str:
    """//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com → 真实地址"""
    absolute = f"https:{url}" if url.startswith("//") else url
    if "uddg=" not in absolute:
        return absolute
    try:
        return unquote(absolute.split("uddg=", 1)[1].split("&", 1)[0])
    except Exception:
        return absolute


def _is_captcha(soup: BeautifulSoup) -> bool:
    if soup.select_one("body > form div.filters table"):
        return True
    if soup.select_one("#challenge-form, .anomaly-modal__mask, form[action*=challenge]"):
        return True
    if soup.select("div.result") or soup.select("a.result-link"):
        return False
    text = soup.get_text(" ", strip=True).lower()
    return any(k in text for k in ("unusual traffic", "anomaly", "confirm this search was made by a human"))


def _parse_html(body: str, size: int) -> list[dict]:
    soup = BeautifulSoup(body, "lxml")
    if _is_captcha(soup):
        raise DDGError("anti-bot challenge (CAPTCHA)")

    items: list[dict] = []
    seen: set[str] = set()
    for el in soup.select("div.result, div.web-result"):
        classes = el.get("class") or []
        if "result--ad" in classes or "result--ad-u" in classes:
            continue
        a = el.select_one("h2.result__title a.result__a") or el.select_one("a.result__a")
        if not a:
            continue
        raw = a.get("href", "")
        if "y.js" in raw:  # 广告
            continue
        link = _unwrap_redirect(raw)
        title = a.get_text(strip=True)
        if not title or not link.startswith("http") or link in seen:
            continue
        sn = el.select_one(".result__snippet")
        seen.add(link)
        items.append({
            "title": title,
            "url": link,
            "text": _WS.sub(" ", sn.get_text(" ", strip=True)) if sn else "",
        })
        if len(items) >= size:
            break
    return items


def _parse_lite(body: str, size: int) -> list[dict]:
    """lite 版是纯 table 布局：a.result-link + td.result-snippet"""
    soup = BeautifulSoup(body, "lxml")
    if _is_captcha(soup):
        raise DDGError("anti-bot challenge (CAPTCHA)")

    items: list[dict] = []
    seen: set[str] = set()
    for a in soup.select("a.result-link"):
        raw = a.get("href", "")
        if "y.js" in raw:
            continue
        link = _unwrap_redirect(raw)
        title = a.get_text(strip=True)
        if not title or not link.startswith("http") or link in seen:
            continue
        snippet = ""
        row = a.find_parent("tr")
        while row is not None:
            row = row.find_next_sibling("tr")
            if row is None:
                break
            td = row.select_one("td.result-snippet")
            if td:
                snippet = _WS.sub(" ", td.get_text(" ", strip=True))
                break
            if row.select_one("a.result-link"):
                break
        seen.add(link)
        items.append({"title": title, "url": link, "text": snippet})
        if len(items) >= size:
            break
    return items


def _headers(endpoint: str, cookie: str, accept_language: str) -> dict:
    origin = endpoint.rsplit("/", 2)[0]
    return {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": accept_language,
        "Origin": origin,
        "Referer": f"{origin}/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Cookie": cookie,
    }


async def _post(endpoint: str, form: dict, cookie: str, accept_language: str) -> str:
    r = await asyncio.to_thread(
        lambda: cffi.post(
            endpoint,
            data=form,
            headers=_headers(endpoint, cookie, accept_language),
            impersonate=IMPERSONATE,
            timeout=30,
        )
    )
    if r.status_code >= 400:
        raise DDGError(f"request failed with status {r.status_code}")
    return r.text


async def search(query: str, count: int = 10, region: str = "auto",
                 time_range: str = "all", safe_search: str = "moderate") -> dict:
    query = (query or "").strip()
    if not query:
        raise DDGError("query is required")
    if len(query) >= 500:
        raise DDGError("DuckDuckGo does not accept queries longer than 499 characters")

    count = min(max(int(count), 1), 30)
    region = (region or "auto").strip()
    df = time_range if time_range and time_range != "all" else None
    p = {"off": "-2", "strict": "1"}.get(safe_search, "-1")

    cookie = f"kl={region}; " if region and region != "auto" else ""
    cookie += f"p={p}"
    if df:
        cookie += f"; df={df}"

    form = {"q": query, "b": "", "kl": "" if region == "auto" else region}
    if df:
        form["df"] = df

    errors: list[str] = []
    for attempt in range(MAX_ATTEMPTS):
        # html 优先，第二轮起把 lite 也算进来
        targets = [(HTML_ENDPOINT, _parse_html)]
        if attempt > 0:
            targets.append((LITE_ENDPOINT, _parse_lite))
        for endpoint, parser in targets:
            await search_throttle.acquire()
            tag = "html" if endpoint is HTML_ENDPOINT else "lite"
            try:
                body = await _post(endpoint, form, cookie, "en-US,en;q=0.9")
                items = parser(body, count)
                if items:
                    return {"items": items, "images": [], "source": tag}
                errors.append(f"{tag}#{attempt}: empty")
            except DDGError as e:
                errors.append(f"{tag}#{attempt}: {e}")
            except Exception as e:
                errors.append(f"{tag}#{attempt}: {type(e).__name__} {e}")
        if attempt < MAX_ATTEMPTS - 1:
            await asyncio.sleep(2.0 * (attempt + 1) + random.uniform(0, 1.5))

    raise DDGError(
        "No results found. Likely DuckDuckGo bot detection, or the query has no match. "
        f"Retry in a minute. [{' | '.join(errors)}]"
    )


async def scrape(url: str, max_length: int = MAX_SCRAPE_LENGTH) -> dict:
    url = (url or "").strip()
    if not url:
        raise DDGError("url is required")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    await scrape_throttle.acquire()
    r = await asyncio.to_thread(
        lambda: cffi.get(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
            impersonate=IMPERSONATE,
            timeout=30,
            allow_redirects=True,
        )
    )
    if r.status_code >= 400:
        raise DDGError(f"Failed to fetch the page ({r.status_code})")

    soup = BeautifulSoup(r.text, "lxml")
    for tag in soup.find_all(NOISE_TAGS):
        tag.decompose()

    body = soup.body or soup
    content = _WS.sub(" ", body.get_text(" ", strip=True)).strip()
    if not content:
        raise DDGError(f"No readable content extracted from {url}")
    limit = min(max(int(max_length), 500), 40000)
    truncated = len(content) > limit
    if truncated:
        content = content[:limit] + "... [content truncated]"

    desc = soup.select_one("meta[name=description]")
    html_tag = soup.select_one("html")
    return {
        "urls": [{
            "url": str(r.url),
            "content": content,
            "metadata": {
                "title": (soup.title.get_text(strip=True) if soup.title else None) or None,
                "description": (desc.get("content") or None) if desc else None,
                "language": (html_tag.get("lang") or None) if html_tag else None,
            },
        }],
        "truncated": truncated,
    }


if __name__ == "__main__":
    import json
    import sys

    async def main():
        if len(sys.argv) > 2 and sys.argv[1] == "scrape":
            out = await scrape(sys.argv[2])
        else:
            out = await search(sys.argv[1] if len(sys.argv) > 1 else "rikkahub", 5)
        print(json.dumps(out, ensure_ascii=False, indent=2)[:2500])

    asyncio.run(main())
