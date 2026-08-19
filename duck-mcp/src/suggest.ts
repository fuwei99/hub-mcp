import { httpGet } from './http.js';
import { DdgApiError } from './client.js';

// ─── Types ──────────────────────────────────────────────────────────────

export interface SuggestOptions {
  region?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Attempt to strip JSONP wrapper: `ddg_ac(...)` or similar.
 * If the body doesn't look like JSONP, returns it unchanged.
 */
function stripJsonp(body: string): string {
  const trimmed = body.trim();
  // Try to parse as JSON first — if it works, return as-is
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Not valid JSON — might be JSONP
  }

  // Strip common JSONP patterns: fnName(...) or fnName([...])
  const match = trimmed.match(/^\w+\((.+)\)$/s);
  if (match) {
    const inner = match[1].trim();
    // Verify inner content looks parseable
    try {
      JSON.parse(inner);
      return inner;
    } catch {
      // Not valid JSON even after unwrapping
    }
  }

  return trimmed;
}

/**
 * Parse the auto-suggest response.
 * Expected format with `type=list`: [query, [sugg1, sugg2, ...]]
 */
function parseSuggestions(body: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(stripJsonp(body));
  } catch {
    throw new DdgApiError(
      `Failed to parse suggestions response: ${body.slice(0, 200)}`,
    );
  }

  if (Array.isArray(data) && data.length >= 2 && Array.isArray(data[1])) {
    return data[1] as string[];
  }

  return [];
}

// ─── getSuggestions ──────────────────────────────────────────────────────

/**
 * Fetch auto-suggestions from DuckDuckGo.
 *
 * Uses the `/ac/` endpoint which does NOT require VQD tokens.
 * Response format with `type=list`: [query, [sugg1, sugg2, ...]]
 *
 * @param query - Search query
 * @param options - Optional region (e.g. "de-de")
 */
export async function getSuggestions(
  query: string,
  options?: SuggestOptions,
): Promise<string[]> {
  const trimmedQuery = query.trim();

  // Short-circuit for empty query
  if (trimmedQuery.length === 0) {
    return [];
  }

  // Build URL
  const params = new URLSearchParams({
    q: trimmedQuery,
    type: 'list',
  });

  if (options?.region) {
    params.set('kl', options.region);
  }

  const url = `https://duckduckgo.com/ac/?${params.toString()}`;

  const response = await httpGet(url, {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
  }, 5000);

  // Check for non-2xx status
  if (response.status < 200 || response.status >= 300) {
    throw new DdgApiError(
      `HTTP ${response.status}: ${response.body.slice(0, 200)}`,
      response.status,
      response.body,
    );
  }

  return parseSuggestions(response.body);
}
