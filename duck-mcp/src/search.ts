import { httpPost } from './http.js';
import { DdgApiError } from './errors.js';

// ─── Types ──────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  hostname: string;
}

export interface SearchOptions {
  maxResults?: number;
  region?: string;
  safesearch?: 'on' | 'moderate' | 'off';
  timeFilter?: 'day' | 'week' | 'month' | 'year';
}

// ─── Headers for DDG Lite endpoint ──────────────────────────────────────
// Lite is lighter than html.duckduckgo.com/html/ (20% smaller responses).

const LITE_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
  'Accept': 'text/html',
  'Accept-Language': 'en-US,en;q=0.9',
  'Content-Type': 'application/x-www-form-urlencoded',
};

// ─── HTML Helpers ───────────────────────────────────────────────────────

function htmlDecode(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#39;/g, "'")
    .replace(/&#60;/g, '<')
    .replace(/&#62;/g, '>');
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// ─── webSearch ──────────────────────────────────────────────────────────

/**
 * Web search via DuckDuckGo Lite endpoint.
 * Posts to lite.duckduckgo.com/lite/ — lighter than html.duckduckgo.com/html/.
 * No VQD token needed. Bypasses DDG's JS challenge.
 */
export async function webSearch(
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const maxResults = options?.maxResults ?? 10;

  const params = new URLSearchParams({ q: trimmedQuery });
  if (options?.region) {
    params.set('kl', options.region);
  }

  const response = await httpPost(
    'https://lite.duckduckgo.com/lite/',
    params.toString(),
    LITE_HEADERS,
    10000,
  );

  if (response.status < 200 || response.status >= 300) {
    throw new DdgApiError(
      `HTTP ${response.status}: ${response.body.slice(0, 200)}`,
      response.status,
      response.body,
    );
  }

  // Check for DDG anomaly (anti-bot) page
  if (response.body.includes('anomaly-modal') || response.body.includes('challenge')) {
    throw new DdgApiError(
      'DuckDuckGo blocked the request with anti-bot challenge. Try again later or use a different IP.',
      429,
      response.body.slice(0, 300),
    );
  }

  // Parse Lite HTML: <a rel="nofollow" href="URL" class='result-link'>TITLE</a>
  //                   <td class='result-snippet'>SNIPPET</td>
  const linkRegex = /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;

  const urls: string[] = [];
  const titles: string[] = [];
  let match;

  while ((match = linkRegex.exec(response.body)) !== null) {
    const url = match[1].trim();
    const title = match[2].replace(/<[^>]+>/g, '').trim();
    if (url && title) {
      urls.push(url);
      titles.push(title);
    }
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(response.body)) !== null) {
    snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
  }

  const results: SearchResult[] = [];
  for (let i = 0; i < Math.min(titles.length, urls.length, maxResults); i++) {
    const url = urls[i];
    if (!url) continue;
    results.push({
      title: htmlDecode(titles[i] ?? ''),
      url,
      description: htmlDecode(snippets[i] ?? ''),
      hostname: extractHostname(url),
    });
  }

  return results;
}
