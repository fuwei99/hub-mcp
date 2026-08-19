import { httpGet } from './http.js';

export interface VqdOptions {
  region?: string;
}

/** Browser-like headers for DuckDuckGo requests. Shared across the project. */
export const DDG_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://duckduckgo.com",
  Referer: "https://duckduckgo.com/",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  "Content-Type": "application/x-www-form-urlencoded",
};

// ─── VQD Cache ─────────────────────────────────────────────────────────

interface CacheEntry {
  token: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

function buildCacheKey(query: string, region: string): string {
  return `${query}:${region}`;
}

function isExpired(entry: CacheEntry): boolean {
  return Date.now() > entry.expiresAt;
}

// ─── VQD Acquisition ───────────────────────────────────────────────────

class VqdAcquisitionError extends Error {
  constructor(message?: string) {
    super(message ?? 'Failed to acquire VQD token');
    this.name = 'VqdAcquisitionError';
  }
}

/**
 * Fetch a VQD token by visiting the DuckDuckGo search page (GET).
 * Based on the approach used by the deedy5/ddgs library:
 * - GET https://duckduckgo.com/?q=<query>
 * - Parse HTML for vqd="..." pattern
 */
async function fetchVqdToken(query: string): Promise<string> {
  const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;

  let response;
  // Don't catch errors here — let raw network errors propagate so fetchWithRetry can retry them
  response = await httpGet(url, {
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': 'https://duckduckgo.com/',
  }, 10000);

  if (response.status === 403 || response.status === 429) {
    throw new VqdAcquisitionError(`DDG blocked request (HTTP ${response.status})`);
  }

  // Parse vqd="..." from HTML (DDGS library approach)
  const match = response.body.match(/vqd=(["'])([^"']+)\1/);
  if (!match || !match[2]) {
    throw new VqdAcquisitionError('VQD token not found in HTML response');
  }

  return match[2];
}

async function fetchWithRetry(query: string): Promise<string> {
  const delays = [200, 500];

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fetchVqdToken(query);
    } catch (err) {
      if (err instanceof VqdAcquisitionError) {
        throw err;
      }
      // Network error — retry
      if (attempt === delays.length) {
        throw new VqdAcquisitionError(
          `Failed after ${delays.length + 1} attempts: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }

  throw new VqdAcquisitionError('Failed to acquire VQD token');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Clear the in-memory VQD token cache. Useful for testing. */
export function resetVqdCache(): void {
  cache.clear();
}

// ─── Public API ────────────────────────────────────────────────────────

export async function getVqdToken(
  query: string,
  options?: VqdOptions,
): Promise<string> {
  const region = options?.region ?? 'wt-wt';
  const key = buildCacheKey(query, region);

  const cached = cache.get(key);
  if (cached && !isExpired(cached)) {
    return cached.token;
  }

  const token = await fetchWithRetry(query);

  cache.set(key, { token, expiresAt: Date.now() + TTL_MS });
  return token;
}
