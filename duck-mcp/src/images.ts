import { ddgGet } from './client.js';

// ─── Types ──────────────────────────────────────────────────────────────

export interface ImageResult {
  title: string;
  imageUrl: string;
  thumbnailUrl: string;
  sourceUrl: string;
  sourceName: string;
  height: number;
  width: number;
}

export interface ImageSearchOptions {
  maxResults?: number;
  region?: string;
  safesearch?: 'on' | 'moderate' | 'off';
  timeFilter?: 'day' | 'week' | 'month' | 'year';
  size?: 'Small' | 'Medium' | 'Large' | 'Wallpaper';
  color?:
    | 'color'
    | 'Monochrome'
    | 'Red'
    | 'Orange'
    | 'Yellow'
    | 'Green'
    | 'Blue'
    | 'Purple'
    | 'Pink'
    | 'Brown'
    | 'Black'
    | 'Gray'
    | 'White'
    | 'Teal'
    | 'Aqua';
  type?: 'photo' | 'clipart' | 'gif' | 'transparent' | 'line';
  layout?: 'Square' | 'Tall' | 'Wide';
  license?: 'Share' | 'ShareCommercially' | 'Modify' | 'ModifyCommercially';
}

// ─── Internal types ────────────────────────────────────────────────────

interface RawImageResult {
  title?: string;
  image?: string;
  thumbnail?: string;
  url?: string;
  source?: string;
  height?: number;
  width?: number;
}

interface RawImageResponse {
  results?: RawImageResult[];
}

// ─── imageSearch ───────────────────────────────────────────────────────

/**
 * Image search via DuckDuckGo i.js endpoint.
 * Returns image results with direct image URLs and metadata.
 *
 * Supports filtering by size, color, type, layout, license, and time.
 */
export async function imageSearch(
  query: string,
  options?: ImageSearchOptions,
): Promise<ImageResult[]> {
  const maxResults = options?.maxResults ?? 10;

  // Build filter string (`f` param) for DDG
  const filters: string[] = [];
  if (options?.size) filters.push(`size:${options.size}`);
  if (options?.color) filters.push(`color:${options.color}`);
  if (options?.type) filters.push(`type:${options.type}`);
  if (options?.layout) filters.push(`layout:${options.layout}`);
  if (options?.license) filters.push(`license:${options.license}`);
  if (options?.timeFilter) {
    const tfMap: Record<string, string> = {
      day: 'd',
      week: 'w',
      month: 'm',
      year: 'y',
    };
    filters.push(`time:${tfMap[options.timeFilter]}`);
  }

  // Build query params
  const params: Record<string, string> = { q: query };

  if (options?.region) params.l = options.region;
  if (options?.safesearch) {
    const ssMap: Record<string, string> = {
      on: '1',
      moderate: '-1',
      off: '-2',
    };
    params.p = ssMap[options.safesearch];
  }
  if (filters.length > 0) {
    params.f = filters.join(',');
  }

  const raw = await ddgGet<RawImageResponse>('duckduckgo.com/i.js', params);

  if (!raw?.results || !Array.isArray(raw.results)) return [];

  return raw.results
    .filter((r): r is RawImageResult & { image: string; url: string } =>
      typeof r.image === 'string' && r.image.length > 0 &&
      typeof r.url === 'string' && r.url.length > 0,
    )
    .slice(0, maxResults)
    .map((r) => ({
      title: r.title ?? '',
      imageUrl: r.image,
      thumbnailUrl: r.thumbnail ?? '',
      sourceUrl: r.url,
      sourceName: r.source ?? '',
      height: r.height ?? 0,
      width: r.width ?? 0,
    }));
}
