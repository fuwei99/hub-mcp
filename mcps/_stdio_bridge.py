"""stdio 子进程桥公共实现。

⚠️ 核心教训（踩过的坑，别再改回去）：
    anyio 的 cancel scope / task group **不能跨 task 使用**。
    `stdio_client()` 和 `ClientSession()` 都是 task-bound 的异步上下文：
    如果在 A 请求的 task 里 __aenter__ 然后缓存到全局给 B 请求用，
    会得到 `RuntimeError: Attempted to exit cancel scope in a different task`，
    实际表现是请求**永久静默无响应**（不报错、不超时、SSE 只剩 ping）。

    → 所以这里不做任何跨请求的 session 缓存：
      每次 list_tools / call_tool 都在**当前 task 内**开子进程、用完即关，
      整个生命周期闭合在同一个 async with 里。

    子进程启动成本换来的是正确性；如需提速，正确做法是起一个专属的
    长驻 worker task + 队列（所有 IO 都在那个 task 内做），而不是共享 session。
"""
import asyncio

from mcp import types


class StdioBridge:
    def __init__(self, params_factory, timeout: float = 90.0):
        """params_factory: () -> StdioServerParameters（延迟构造，避免 import 期副作用）"""
        self._params_factory = params_factory
        self._timeout = timeout
        self._tools_cache = None  # 只缓存工具「描述」（纯数据，可跨 task）

    async def _session(self, fn):
        """在当前 task 内开子进程 → 执行 fn(session) → 关闭。全程同一 task。"""
        from mcp import ClientSession
        from mcp.client.stdio import stdio_client

        async with stdio_client(self._params_factory()) as (read, write):
            async with ClientSession(read, write) as session:
                await asyncio.wait_for(session.initialize(), timeout=self._timeout)
                return await asyncio.wait_for(fn(session), timeout=self._timeout)

    async def list_tools(self) -> list[types.Tool]:
        if self._tools_cache is None:
            res = await self._session(lambda s: s.list_tools())
            self._tools_cache = [
                types.Tool(
                    name=t.name,
                    description=t.description or "",
                    inputSchema=t.inputSchema,
                )
                for t in res.tools
            ]
        return self._tools_cache

    async def call_tool(self, name: str, arguments: dict) -> list[types.TextContent]:
        res = await self._session(lambda s: s.call_tool(name, arguments or {}))
        out = []
        for c in res.content:
            text = c.text if getattr(c, "type", None) == "text" else str(c)
            out.append(types.TextContent(type="text", text=text))
        return out or [types.TextContent(type="text", text="(empty)")]
