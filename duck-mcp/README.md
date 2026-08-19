# ddg-search-mcp

MCP server for DuckDuckGo — **AI answers, web search, news, images, videos, URL fetch, suggestions, definitions, and currency conversion**. No API key needed.

> Rivals Exa AI for the free tier. Powered by DuckDuckGo's undocumented QnA endpoint, with browser-grade TLS fingerprinting.

## Features

| Tool | Description | Parameters |
|------|-------------|------------|
| `ddg_get_answer` | AI answer with sources (like Exa Answer API) | query, region |
| `ddg_search` | Web search | query, maxResults, region, safesearch, freshness |
| `ddg_search_news` | News search | query, maxResults, region, safesearch, freshness |
| `ddg_search_images` | Image search | query, maxResults, region, safesearch, freshness, size, color, type, layout, license |
| `ddg_search_videos` | Video search | query, maxResults, region, safesearch, freshness, resolution, duration, license |
| `ddg_fetch_content` | URL content extraction with TLS fingerprint | url, maxLength |
| `ddg_get_suggestions` | Search suggestions / auto-complete | query, region |
| `ddg_get_definition` | Dictionary definitions via DDG | word |
| `ddg_convert_currency` | Currency conversion via DDG | amount, from, to |

## Quick Start

### Claude Desktop / Cursor / VS Code

```json
{
  "mcpServers": {
    "ddg-search": {
      "command": "npx",
      "args": ["ddg-search-mcp"]
    }
  }
}
```

### CLI

```bash
npx ddg-search-mcp
```

## Search Parameters

| Parameter | Tools | Values |
|-----------|-------|--------|
| `region` | All except fetch | `'us-en'`, `'vn-vi'`, `'wt-wt'` (worldwide) |
| `safesearch` | search, news, images | `'on'`, `'moderate'`, `'off'` |
| `freshness` | search, news, images | `'day'`, `'week'`, `'month'`, `'year'` |
| `size` | images | `'Small'`, `'Medium'`, `'Large'`, `'Wallpaper'` |
| `color` | images | `'Monochrome'`, `'Red'`, `'Blue'`, `'Green'`, etc. |
| `type` | images | `'photo'`, `'clipart'`, `'gif'`, `'transparent'`, `'line'` |
| `layout` | images | `'Square'`, `'Tall'`, `'Wide'` |
| `license` | images | `'Share'`, `'ShareCommercially'`, `'Modify'`, `'ModifyCommercially'` |

## Example Queries (for AI assistants)

```json
// Get AI answer
{ "query": "what is quantum computing" }

// Web search with filters
{ "query": "latest AI news", "freshness": "week", "safesearch": "moderate" }

// News in a specific region
{ "query": "technology", "region": "us-en", "freshness": "day" }

// Image search
{ "query": "mountain landscape", "size": "Wallpaper", "color": "Green" }

// Fetch page content
{ "url": "https://example.com/article" }
```

## Why DuckDuckGo?

| Feature | Exa AI | ddg-search-mcp |
|---------|--------|----------------|
| Search | $7/1K req | **Free** |
| Answer | $5/1K req | **Free** (qna.js) |
| Content Fetch | $1/1K pages | **Free** |
| Image Search | — | **Free** |
| API Key | Required | **Not needed** |

## Technical Highlights

- **No API key required** — uses DuckDuckGo's public API endpoints
- **Browser-grade TLS** — custom TLS agent with Chrome 134 cipher suite order, avoids bot detection
- **VQD token management** — automatic VQD acquisition with 5-minute cache
- **Rate limiting** — 200ms minimum gap between requests
- **Safe content fetch** — blocks private IPs, localhost, and SSRF attack vectors
- **All outputs in Markdown** — AI-friendly structured output

## Development

```bash
git clone https://github.com/hung319/duck-mcp
cd duck-mcp
npm install
npm run build
npm test        # 88+ tests
npm start       # Run MCP server
```

## License

MIT
