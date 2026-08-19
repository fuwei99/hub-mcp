import { describe, it, expect, beforeEach, vi } from "vitest";
import { getVqdToken, resetVqdCache } from "./vqd.js";

// ─── Mocks ─────────────────────────────────────────────────────────────

vi.mock("./http.js", () => ({
  httpGet: vi.fn(),
}));

import { httpGet } from "./http.js";
const mockHttpGet = vi.mocked(httpGet);

const TEST_TOKEN = "4-263850069949942448194933821502839833765";

function makeHtmlWithVqd(token: string): string {
  return `<!DOCTYPE html><html><head><script>var vqd='${token}';</script></head><body>...</body></html>`;
}

function makeVqdResponse(
  body: string,
  status = 200,
) {
  return { status, body, headers: {} };
}

describe("getVqdToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetVqdCache();
  });

  describe("cache behavior", () => {
    it("returns cached token on second call without fetching", async () => {
      mockHttpGet.mockResolvedValue(makeVqdResponse(makeHtmlWithVqd(TEST_TOKEN)));

      const first = await getVqdToken("hello");
      expect(first).toBe(TEST_TOKEN);

      // Reset call count — second call should not call httpGet
      mockHttpGet.mockClear();

      const second = await getVqdToken("hello");
      expect(second).toBe(TEST_TOKEN);
      expect(mockHttpGet).not.toHaveBeenCalled();
    });

    it("uses different cache keys for different queries", async () => {
      mockHttpGet.mockResolvedValue(makeVqdResponse(makeHtmlWithVqd(TEST_TOKEN)));

      await getVqdToken("query1");
      await getVqdToken("query2");

      expect(mockHttpGet).toHaveBeenCalledTimes(2);
    });

    it("uses different cache keys for different regions", async () => {
      mockHttpGet.mockResolvedValue(makeVqdResponse(makeHtmlWithVqd(TEST_TOKEN)));

      await getVqdToken("test", { region: "us-en" });
      await getVqdToken("test", { region: "de-de" });

      expect(mockHttpGet).toHaveBeenCalledTimes(2);
    });

    it("defaults region to wt-wt when not provided", async () => {
      mockHttpGet.mockResolvedValue(makeVqdResponse(makeHtmlWithVqd(TEST_TOKEN)));

      await getVqdToken("test");
      await getVqdToken("test", { region: "wt-wt" });

      // Both should hit same cache key
      expect(mockHttpGet).toHaveBeenCalledTimes(1);
    });
  });

  describe("VQD acquisition", () => {
    it("sends GET request to duckduckgo.com with encoded query", async () => {
      mockHttpGet.mockResolvedValue(makeVqdResponse(makeHtmlWithVqd(TEST_TOKEN)));

      await getVqdToken("hello world");

      expect(mockHttpGet).toHaveBeenCalledWith(
        "https://duckduckgo.com/?q=hello%20world",
        expect.any(Object),
        expect.any(Number),
      );
    });

    it("sends browser-like headers", async () => {
      mockHttpGet.mockResolvedValue(makeVqdResponse(makeHtmlWithVqd(TEST_TOKEN)));

      await getVqdToken("test");

      const [, headers] = mockHttpGet.mock.calls[0];
      expect(headers["User-Agent"]).toContain("Mozilla/5.0");
      expect(headers["Accept"]).toBe("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
      expect(headers["Accept-Language"]).toBe("en-US,en;q=0.5");
      expect(headers["Referer"]).toBe("https://duckduckgo.com/");
    });

    it("extracts VQD from HTML body", async () => {
      mockHttpGet.mockResolvedValue(makeVqdResponse(makeHtmlWithVqd(TEST_TOKEN)));

      const token = await getVqdToken("test");
      expect(token).toBe(TEST_TOKEN);
    });

    it("extracts VQD with double quotes", async () => {
      const html = `vqd="${TEST_TOKEN}"`;
      mockHttpGet.mockResolvedValue(makeVqdResponse(html));

      const token = await getVqdToken("test");
      expect(token).toBe(TEST_TOKEN);
    });

    it("extracts VQD with single quotes", async () => {
      const html = `vqd='${TEST_TOKEN}'`;
      mockHttpGet.mockResolvedValue(makeVqdResponse(html));

      const token = await getVqdToken("test");
      expect(token).toBe(TEST_TOKEN);
    });

    it("throws when VQD is missing from HTML", async () => {
      mockHttpGet.mockResolvedValue(makeVqdResponse("<html>no vqd here</html>"));

      await expect(getVqdToken("test")).rejects.toThrow(
        "VQD token not found in HTML response"
      );
    });
  });

  describe("error handling", () => {
    it("retries on network error with exponential backoff", async () => {
      mockHttpGet
        .mockRejectedValueOnce(new Error("Network failure"))
        .mockRejectedValueOnce(new Error("Network failure"))
        .mockResolvedValue(makeVqdResponse(makeHtmlWithVqd(TEST_TOKEN)));

      const token = await getVqdToken("test");
      expect(token).toBe(TEST_TOKEN);
      expect(mockHttpGet).toHaveBeenCalledTimes(3);
    });

    it("throws on 403 without retry", async () => {
      mockHttpGet.mockResolvedValue({
        status: 403, body: "", headers: {},
      });

      await expect(getVqdToken("test")).rejects.toThrow(
        "DDG blocked request (HTTP 403)"
      );
      expect(mockHttpGet).toHaveBeenCalledTimes(1);
    });

    it("throws on 429 without retry", async () => {
      mockHttpGet.mockResolvedValue({
        status: 429, body: "", headers: {},
      });

      await expect(getVqdToken("test")).rejects.toThrow(
        "DDG blocked request (HTTP 429)"
      );
      expect(mockHttpGet).toHaveBeenCalledTimes(1);
    });
  });
});
