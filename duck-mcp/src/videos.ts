import { ddgGet } from './client.js';

// ─── Types ──────────────────────────────────────────────────────────────

export interface VideoResult {
  title: string;
  url: string;
  description: string;
  duration: string;
  embedUrl: string;
  provider: string;
  publisher: string;
  published: string;
  uploader: string;
  statistics: string;
  imageUrl: string;
}

export interface VideoSearchOptions {
  maxResults?: number;
  region?: string;
  safesearch?: 'on' | 'moderate' | 'off';
  timeFilter?: 'day' | 'week' | 'month' | 'year';
  resolution?: 'high' | 'standard';
  duration?: 'short' | 'medium' | 'long';
  license?: 'free' | 'creativeCommon';
}

// ─── Internal types ────────────────────────────────────────────────────

interface RawVideoResult {
  content?: string;
  description?: string;
  duration?: string;
  embed_html?: string;
  embed_url?: string;
  images?: Record<string, { url: string; height: number; width: number }>;
  provider?: string;
  published?: string;
  publisher?: string;
  statistics?: string;
  title?: string;
  uploader?: string;
}

interface RawVideoResponse {
  results?: RawVideoResult[];
}

// ─── Helpers ───────────────────────────────────────────────────────────

const SAFESEARCH_MAP: Record<string, string> = {
  on: '1',
  moderate: '-1',
  off: '-2',
};

const TIMEFILTER_MAP: Record<string, string> = {
  day: 'd',
  week: 'w',
  month: 'm',
  year: 'y',
};

// ─── videoSearch ───────────────────────────────────────────────────────

/**
 * Video search via DuckDuckGo v.js endpoint.
 * Returns video results with metadata like duration, uploader, and views.
 *
 * Supports filtering by resolution, duration, license, and time.
 */
export async function videoSearch(
  query: string,
  options?: VideoSearchOptions,
): Promise<VideoResult[]> {
  const maxResults = options?.maxResults ?? 10;

  // Build filter string (`f` param) for DDG
  const filters: string[] = [];
  if (options?.resolution) {
    filters.push(`videoDefinition:${options.resolution}`);
  }
  if (options?.duration) {
    filters.push(`videoDuration:${options.duration}`);
  }
  if (options?.license) {
    filters.push(`videoLicense:${options.license}`);
  }
  if (options?.timeFilter) {
    filters.push(`publishedAfter:${TIMEFILTER_MAP[options.timeFilter]}`);
  }

  // Build query params
  const params: Record<string, string> = { q: query };

  if (options?.region) params.l = options.region;
  if (options?.safesearch) {
    params.p = SAFESEARCH_MAP[options.safesearch];
  }
  if (filters.length > 0) {
    params.f = filters.join(',');
  }

  const raw = await ddgGet<RawVideoResponse>('duckduckgo.com/v.js', params);

  if (!raw?.results || !Array.isArray(raw.results)) return [];

  return raw.results
    .filter(
      (r): r is RawVideoResult & { content: string; title: string } =>
        typeof r.content === 'string' &&
        r.content.length > 0 &&
        typeof r.title === 'string' &&
        r.title.length > 0,
    )
    .slice(0, maxResults)
    .map((r) => {
      // Extract best available image
      let imageUrl = '';
      if (r.images) {
        // Prefer large, fallback to medium, then small
        for (const size of ['large', 'medium', 'small']) {
          if (r.images[size]?.url) {
            imageUrl = r.images[size].url;
            break;
          }
        }
      }

      return {
        title: r.title,
        url: r.content,
        description: r.description ?? '',
        duration: r.duration ?? '',
        embedUrl: r.embed_url ?? '',
        provider: r.provider ?? '',
        publisher: r.publisher ?? '',
        published: r.published ?? '',
        uploader: r.uploader ?? '',
        statistics: r.statistics ?? '',
        imageUrl,
      };
    });
}
