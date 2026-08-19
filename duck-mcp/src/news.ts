import { ddgGet, DdgApiError } from './client.js';

// ─── Types ──────────────────────────────────────────────────────────────

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  date: string;
  snippet: string;
  image?: string;
}

export interface NewsSearchOptions {
  maxResults?: number;
  region?: string;
  safesearch?: 'on' | 'moderate' | 'off';
  timeFilter?: 'day' | 'week' | 'month' | 'year';
}

// ─── Internal types ────────────────────────────────────────────────────

interface RawNewsResult {
  date?: number;           // Unix timestamp
  excerpt?: string;        // HTML snippet
  image?: string;          // Thumbnail URL
  title?: string;
  url?: string;
  source?: string;
  relative_time?: string;
  syndicate?: number;
  image_token?: number;
}

interface RawNewsResponse {
  results?: RawNewsResult[];
  query?: string;
  response_type?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#39;/g, "'")
    .trim();
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function formatTimestamp(ts?: number): string {
  if (!ts) return '';
  try {
    const date = new Date(ts * 1000);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

// ─── newsSearch ────────────────────────────────────────────────────────

/**
 * News search via DuckDuckGo news.js endpoint.
 * Uses VM-based challenge solver to bypass DDG anti-bot protection.
 * Returns rich JSON with date, image, and source metadata.
 */
export async function newsSearch(
  query: string,
  options?: NewsSearchOptions,
): Promise<NewsItem[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const limit = options?.maxResults ?? 5;

  // Build params for news.js
  const params: Record<string, string> = {
    q: trimmedQuery,
  };

  if (options?.region) {
    params.l = options.region;
  }

  if (options?.safesearch) {
    const ssMap: Record<string, string> = {
      on: '1',
      moderate: '-1',
      off: '-2',
    };
    params.p = ssMap[options.safesearch];
  }

  // Time filter
  if (options?.timeFilter) {
    const tfMap: Record<string, string> = {
      day: 'pd',
      week: 'pw',
      month: 'pm',
      year: 'py',
    };
    params.df = tfMap[options.timeFilter];
  }

  // ddgGet handles VQD + anti-bot tokens automatically
  let raw: RawNewsResponse;
  try {
    raw = await ddgGet<RawNewsResponse>(
      'duckduckgo.com/news.js',
      params,
      { region: options?.region },
    );
  } catch (err) {
    // If news.js returns 403, the challenge solver may have failed
    // Throw a descriptive error
    if (err instanceof DdgApiError && err.statusCode === 403) {
      throw new DdgApiError(
        'News API blocked by anti-bot protection. The challenge solver may need updating.',
        403,
      );
    }
    throw err;
  }

  if (!raw?.results || !Array.isArray(raw.results)) return [];

  return raw.results
    .filter((r): r is RawNewsResult & { title: string; url: string } =>
      typeof r.title === 'string' && r.title.length > 0 &&
      typeof r.url === 'string' && r.url.length > 0,
    )
    .slice(0, limit)
    .map((r) => ({
      title: stripHtml(r.title),
      url: r.url,
      source: r.source ?? extractHostname(r.url),
      date: r.relative_time ?? formatTimestamp(r.date),
      snippet: stripHtml(r.excerpt ?? ''),
      image: r.image || undefined,
    }));
}
