#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getAnswer } from "./qna.js";
import { webSearch } from "./search.js";
import { newsSearch } from "./news.js";
import { fetchContent } from "./fetch.js";
import { imageSearch } from "./images.js";
import { videoSearch } from "./videos.js";
import { getSuggestions } from "./suggest.js";
import { getDefinition, convertCurrency } from "./instant.js";

// ─── Shared schemas ────────────────────────────────────────────────────

const safesearchSchema = z.enum(["on", "moderate", "off"]).optional().describe("SafeSearch level (default: moderate)");
const timeFilterSchema = z.enum(["day", "week", "month", "year"]).optional().describe("Time filter for results");
const regionSchema = z.string().optional().describe("Region code (e.g. 'us-en', 'vn-vi', 'wt-wt' for worldwide)");

// ─── MCP Server ─────────────────────────────────────────────────────────

const server = new McpServer({
  name: "ddg-search-mcp",
  version: "1.1.0",
});

// ─── Tool 1: ddg_get_answer ─────────────────────────────────────────────

server.tool(
  "ddg_get_answer",
  "Get an AI-powered answer with sources for a question (like Exa Answer). Uses DuckDuckGo Instant Answer engine with Wikipedia.",
  {
    query: z.string().min(1).describe("The question or search query"),
    region: regionSchema.describe("Region code for localized answers"),
  },
  async ({ query, region }) => {
    try {
      const result = await getAnswer(query, { region });
      if (!result) {
        return {
          content: [{ type: "text" as const, text: "No answer found for this query. The QnA endpoint may be temporarily unavailable." }],
        };
      }

      const lines: string[] = [];
      lines.push(`## Answer\n\n${result.answer}\n`);

      if (result.expandedAnswer) {
        lines.push(`## Details\n\n${result.expandedAnswer}\n`);
      }

      if (result.sources && result.sources.length > 0) {
        lines.push(`## Sources (${result.sources.length})`);
        for (const source of result.sources) {
          const link = source.link ? ` [${source.link}](${source.link})` : "";
          lines.push(`- **${source.site}**: ${source.text}${link}`);
        }
        lines.push("");
      }

      lines.push(`---\n*Score: ${(result.score * 100).toFixed(0)}% confident*`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 403 = DDG blocked QnA endpoint
      if (msg.includes('403')) {
        return {
          content: [{ type: "text" as const, text: "The DuckDuckGo QnA (AI answer) endpoint is temporarily blocked by DuckDuckGo's anti-bot protection. Try rephrasing your query or using ddg_search + ddg_fetch_content to find the answer manually." }],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Error fetching answer: ${msg}`,
          },
        ],
      };
    }
  },
);

// ─── Tool 2: ddg_search ─────────────────────────────────────────────────

server.tool(
  "ddg_search",
  "Search the web using DuckDuckGo. Returns organic results with titles, URLs, and descriptions.",
  {
    query: z.string().min(1).describe("Search query"),
    maxResults: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe("Maximum results to return (default 10, max 50)"),
    region: regionSchema,
    safesearch: safesearchSchema,
    freshness: timeFilterSchema.describe("Filter by time: 'day', 'week', 'month', 'year'"),
  },
  async ({ query, maxResults, region, safesearch, freshness }) => {
    try {
      const results = await webSearch(query, {
        maxResults,
        ...(region ? { region } : {}),
        ...(safesearch ? { safesearch } : {}),
        ...(freshness ? { timeFilter: freshness } : {}),
      });

      if (!results || results.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No search results found." }],
        };
      }

      const lines: string[] = [];
      lines.push(`# Search Results for "${query}"\n`);

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        lines.push(`## ${i + 1}. [${r.title}](${r.url})`);
        if (r.description) lines.push(`\n${r.description}\n`);
        if (r.hostname) lines.push(`\`${r.hostname}\``);
        lines.push("");
      }

      lines.push(`---\n*${results.length} results*`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error performing search: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

// ─── Tool 3: ddg_search_news ────────────────────────────────────────────

server.tool(
  "ddg_search_news",
  "Search news articles using DuckDuckGo. Returns recent news with sources and dates.",
  {
    query: z.string().min(1).describe("News search query"),
    maxResults: z
      .number()
      .min(1)
      .max(30)
      .optional()
      .default(5)
      .describe("Maximum news results (default 5, max 30)"),
    region: regionSchema,
    safesearch: safesearchSchema,
    freshness: timeFilterSchema.describe("Filter by time: 'day', 'week', 'month', 'year'"),
  },
  async ({ query, maxResults, region, safesearch, freshness }) => {
    try {
      const results = await newsSearch(query, {
        maxResults,
        ...(region ? { region } : {}),
        ...(safesearch ? { safesearch } : {}),
        ...(freshness ? { timeFilter: freshness } : {}),
      });

      if (!results || results.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No news results found." }],
        };
      }

      const lines: string[] = [];
      lines.push(`# News Results for "${query}"\n`);

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        lines.push(`## ${i + 1}. [${r.title}](${r.url})`);
        if (r.snippet) lines.push(`\n${r.snippet}\n`);
        lines.push(`| | |`);
        lines.push(`|---|---|`);
        lines.push(`| **Source** | ${r.source} |`);
        lines.push(`| **Date** | ${r.date} |`);
        if (r.image) lines.push(`| **Image** | ![Thumbnail](${r.image}) |`);
        lines.push("");
      }

      lines.push(`---\n*${results.length} news articles*`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error fetching news: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

// ─── Tool 4: ddg_search_images ──────────────────────────────────────────

server.tool(
  "ddg_search_images",
  "Search images using DuckDuckGo. Returns image results with direct URLs, thumbnails, and metadata.",
  {
    query: z.string().min(1).describe("Image search query"),
    maxResults: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe("Maximum image results (default 10, max 50)"),
    region: regionSchema,
    safesearch: safesearchSchema,
    freshness: timeFilterSchema.describe("Filter by time: 'day', 'week', 'month', 'year'"),
    size: z
      .enum(["Small", "Medium", "Large", "Wallpaper"])
      .optional()
      .describe("Filter by image size"),
    color: z
      .enum([
        "color", "Monochrome", "Red", "Orange", "Yellow", "Green",
        "Blue", "Purple", "Pink", "Brown", "Black", "Gray", "White",
        "Teal", "Aqua",
      ])
      .optional()
      .describe("Filter by dominant color"),
    type: z
      .enum(["photo", "clipart", "gif", "transparent", "line"])
      .optional()
      .describe("Filter by image type"),
    layout: z
      .enum(["Square", "Tall", "Wide"])
      .optional()
      .describe("Filter by image layout/aspect ratio"),
    license: z
      .enum(["Share", "ShareCommercially", "Modify", "ModifyCommercially"])
      .optional()
      .describe("Filter by license"),
  },
  async ({ query, maxResults, region, safesearch, freshness, size, color, type, layout, license }) => {
    try {
      const results = await imageSearch(query, {
        maxResults,
        ...(region ? { region } : {}),
        ...(safesearch ? { safesearch } : {}),
        ...(freshness ? { timeFilter: freshness } : {}),
        ...(size ? { size } : {}),
        ...(color ? { color } : {}),
        ...(type ? { type } : {}),
        ...(layout ? { layout } : {}),
        ...(license ? { license } : {}),
      });

      if (!results || results.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No image results found." }],
        };
      }

      const lines: string[] = [];
      lines.push(`# Image Results for "${query}"\n`);

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        lines.push(`## ${i + 1}. ${r.title}`);
        lines.push(``);
        lines.push(`![](${r.imageUrl})`);
        lines.push(``);
        lines.push(`| | |`);
        lines.push(`|---|---|`);
        lines.push(`| **Source** | [${r.sourceName}](${r.sourceUrl}) |`);
        lines.push(`| **Dimensions** | ${r.width}×${r.height}px |`);
        if (r.thumbnailUrl && r.thumbnailUrl !== r.imageUrl) {
          lines.push(`| **Thumbnail** | [Link](${r.thumbnailUrl}) |`);
        }
        lines.push("");
      }

      lines.push(`---\n*${results.length} images*`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error fetching images: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

// ─── Tool 5: ddg_search_videos ───────────────────────────────────────────

server.tool(
  "ddg_search_videos",
  "Search videos using DuckDuckGo. Returns video results with duration, uploader, and view statistics.",
  {
    query: z.string().min(1).describe("Video search query"),
    maxResults: z
      .number()
      .min(1)
      .max(30)
      .optional()
      .default(10)
      .describe("Maximum video results (default 10, max 30)"),
    region: regionSchema,
    safesearch: safesearchSchema,
    freshness: timeFilterSchema.describe("Filter by time: 'day', 'week', 'month', 'year'"),
    resolution: z
      .enum(["high", "standard"])
      .optional()
      .describe("Filter by video resolution"),
    duration: z
      .enum(["short", "medium", "long"])
      .optional()
      .describe("Filter by video duration"),
    license: z
      .enum(["free", "creativeCommon"])
      .optional()
      .describe("Filter by video license"),
  },
  async ({ query, maxResults, region, safesearch, freshness, resolution, duration, license }) => {
    try {
      const results = await videoSearch(query, {
        maxResults,
        ...(region ? { region } : {}),
        ...(safesearch ? { safesearch } : {}),
        ...(freshness ? { timeFilter: freshness } : {}),
        ...(resolution ? { resolution } : {}),
        ...(duration ? { duration } : {}),
        ...(license ? { license } : {}),
      });

      if (!results || results.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No video results found." }],
        };
      }

      const lines: string[] = [];
      lines.push(`# Video Results for "${query}"\n`);

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        lines.push(`## ${i + 1}. [${r.title}](${r.url})`);
        if (r.description) lines.push(`\n${r.description}\n`);
        lines.push(`| | |`);
        lines.push(`|---|---|`);
        if (r.duration) lines.push(`| **Duration** | ${r.duration} |`);
        if (r.uploader) lines.push(`| **Uploader** | ${r.uploader} |`);
        if (r.publisher) lines.push(`| **Channel** | ${r.publisher} |`);
        if (r.statistics) lines.push(`| **Views** | ${r.statistics} |`);
        if (r.published) lines.push(`| **Published** | ${r.published} |`);
        if (r.provider) lines.push(`| **Provider** | ${r.provider} |`);
        if (r.imageUrl) lines.push(`| **Thumbnail** | ![Thumbnail](${r.imageUrl}) |`);
        lines.push("");
      }

      lines.push(`---\n*${results.length} videos*`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error fetching videos: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

// ─── Tool 6: ddg_fetch_content ──────────────────────────────────────────

server.tool(
  "ddg_fetch_content",
  "Fetch and extract main content from a URL. Uses browser-grade TLS to avoid blocking. Returns title, description, and clean text content.",
  {
    url: z.string().url().describe("The URL to fetch content from"),
    maxLength: z
      .number()
      .min(100)
      .max(50000)
      .optional()
      .default(5000)
      .describe("Maximum characters to return (default 5000, max 50000)"),
  },
  async ({ url, maxLength }) => {
    try {
      const content = await fetchContent(url, maxLength);

      const lines: string[] = [];
      if (content.title) lines.push(`# ${content.title}\n`);
      if (content.description) lines.push(`> ${content.description}\n`);
      lines.push(`**URL**: ${content.url}\n`);
      lines.push(content.content);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error fetching content: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

// ─── Tool 7: ddg_get_suggestions ──────────────────────────────────────────

server.tool(
  "ddg_get_suggestions",
  "Get search suggestions from DuckDuckGo auto-complete",
  {
    query: z.string().min(1).describe("Search query to get suggestions for"),
    region: z.string().optional().default("wt-wt").describe("Region code (e.g. 'us-en', 'de-de', 'wt-wt' for worldwide)"),
  },
  async ({ query, region }) => {
    try {
      const suggestions = await getSuggestions(query, { region });

      if (!suggestions || suggestions.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No suggestions found." }],
        };
      }

      const lines: string[] = [];
      lines.push(`# Suggestions for "${query}"\n`);

      for (let i = 0; i < suggestions.length; i++) {
        lines.push(`${i + 1}. ${suggestions[i]}`);
      }

      lines.push(`\n---\n*${suggestions.length} suggestions*`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error fetching suggestions: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

// ─── Tool 8: ddg_get_definition ──────────────────────────────────────────

server.tool(
  "ddg_get_definition",
  "Get dictionary definition from DuckDuckGo",
  {
    word: z.string().min(1).describe("The word to look up"),
  },
  async ({ word }) => {
    try {
      const definitions = await getDefinition(word);

      if (!definitions || definitions.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No definitions found for "${word}".` }],
        };
      }

      const lines: string[] = [];
      lines.push(`# Definitions for "${word}"\n`);

      for (const def of definitions) {
        lines.push(`**Word**: ${def.word}`);
        lines.push(`**Part of Speech**: ${def.partOfSpeech}`);
        lines.push(`**Definition**: ${def.text}`);
        lines.push(`**Source**: ${def.sourceDictionary}`);
        if (def.wordnikUrl) lines.push(`**Link**: ${def.wordnikUrl}`);
        if (def.attributionText) lines.push(`**Attribution**: ${def.attributionText}`);
        lines.push("");
      }

      lines.push(`---\n*${definitions.length} definition(s)*`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error fetching definition: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

// ─── Tool 9: ddg_convert_currency ────────────────────────────────────────

server.tool(
  "ddg_convert_currency",
  "Convert currency using DuckDuckGo exchange rates",
  {
    amount: z.number().positive().describe("Amount to convert"),
    from: z.string().min(1).describe("Source currency code (e.g. 'usd', 'eur')"),
    to: z.string().min(1).describe("Target currency code (e.g. 'eur', 'jpy')"),
  },
  async ({ amount, from, to }) => {
    try {
      const result = await convertCurrency(amount, from, to);

      if (!result.to || result.to.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No conversion rates found." }],
        };
      }

      const lines: string[] = [];
      lines.push(`# Currency Conversion\n`);
      lines.push(`**Amount**: ${result.amount} ${result.from.toUpperCase()}`);
      lines.push(`**Timestamp**: ${result.timestamp}`);
      lines.push("");

      for (const rate of result.to) {
        const converted = (result.amount * rate.rate).toFixed(2);
        lines.push(`**${rate.currency.toUpperCase()}**: ${converted} (rate: ${rate.rate})`);
      }

      lines.push(`\n---\n*Rates from DuckDuckGo*`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error converting currency: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
