import { httpGet, httpPost } from './http.js';
import { getVqdToken, DDG_HEADERS } from './vqd.js';
import { getAntiBotTokens, type DdgAntiBotTokens } from './challenge.js';
import { DdgApiError } from './errors.js';

// ─── Re-export DdgApiError ─────────────────────────────────────────────
export { DdgApiError } from './errors.js';

// ─── Rate limiting ────────────────────────────────────────────────────

let lastRequestTime = 0;
const MIN_GAP_MS = 200;

// ─── Anti-bot token cache ─────────────────────────────────────────────

let cachedTokens: DdgAntiBotTokens | null = null;
let tokenExpiresAt = 0;
const TOKEN_TTL_MS = 4 * 60 * 1000; // 4 minutes (challenge tokens expire faster)

async function getAntiBotCache(): Promise<DdgAntiBotTokens> {
  if (cachedTokens && Date.now() < tokenExpiresAt) {
    return cachedTokens;
  }
  try {
    cachedTokens = await getAntiBotTokens();
    tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
  } catch {
    // Fallback to static tokens if challenge solver fails
    cachedTokens = { jsa: '334', jsa_hash: '6f908ed2f5dfacd650dd321a8b805c8b', dp: '' };
    tokenExpiresAt = Date.now() + 60_000; // Retry in 1 minute
  }
  return cachedTokens;
}

/** Reset the anti-bot token cache — exposed for testing. */
export function resetAntiBotCache(): void {
  cachedTokens = null;
  tokenExpiresAt = 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function enforceRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_GAP_MS) {
    await sleep(MIN_GAP_MS - elapsed);
  }
  lastRequestTime = Date.now();
}

/** Reset the rate limiter — exposed for testing. */
export function resetRateLimit(): void {
  lastRequestTime = 0;
}

// ─── ddgGet ───────────────────────────────────────────────────────────

/**
 * Generic DDG API GET request.
 * Automatically attaches VQD token and browser headers.
 * Retries on network errors only (not on 4xx/5xx).
 *
 * @param endpoint - API endpoint (e.g. "links.duckduckgo.com/d.js")
 * @param params - Query parameters including "q" (search query)
 * @param options - Optional: maxRetries (default 2), region
 */
export async function ddgGet<T>(
  endpoint: string,
  params: Record<string, string>,
  options?: { maxRetries?: number; region?: string },
): Promise<T> {
  const query = params.q ?? '';
  const [vqd, antiBot] = await Promise.all([
    getVqdToken(query, { region: options?.region }),
    getAntiBotCache(),
  ]);
  const maxRetries = options?.maxRetries ?? 2;

  // Build URL with anti-bot tokens
  const searchParams = new URLSearchParams(params);
  searchParams.set('q', query);
  searchParams.set('vqd', vqd);
  searchParams.set('o', 'json');
  if (antiBot.dp) {
    searchParams.set('jsa', antiBot.jsa);
    searchParams.set('jsa_hash', antiBot.jsa_hash);
    searchParams.set('dp', antiBot.dp);
  }
  const url = `https://${endpoint}?${searchParams.toString()}`;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await enforceRateLimit();

      const response = await httpGet(url, DDG_HEADERS, 15000);

      if (response.status < 200 || response.status >= 300) {
        throw new DdgApiError(
          `HTTP ${response.status}: ${response.body.slice(0, 200)}`,
          response.status,
          response.body,
        );
      }

      try {
        return JSON.parse(response.body) as T;
      } catch {
        throw new DdgApiError(
          `Failed to parse JSON response: ${response.body.slice(0, 200)}`,
          response.status,
          response.body,
        );
      }
    } catch (err) {
      // DdgApiError (4xx/5xx) — do not retry
      if (err instanceof DdgApiError) {
        throw err;
      }

      // Network error — retry if attempts remain
      if (attempt < maxRetries) {
        await sleep(200 * (attempt + 1)); // Simple backoff
      }

      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw new DdgApiError(
    `Request failed after ${maxRetries + 1} attempts: ${lastError?.message ?? 'Unknown error'}`,
  );
}

// ─── ddgPost ──────────────────────────────────────────────────────────

/**
 * Generic DDG API POST request.
 * Body is JSON. Attaches VQD token and browser headers.
 *
 * @param endpoint - API endpoint (e.g. "duckduckgo.com/qna")
 * @param query - Search query (used for VQD and URL)
 * @param body - JSON body for the POST request
 * @param options - Optional: signal ('low' | 'high'), region
 */
export async function ddgPost<T>(
  endpoint: string,
  query: string,
  body: Record<string, unknown>,
  options?: { signal?: 'low' | 'high'; region?: string },
): Promise<T> {
  const [vqd, antiBot] = await Promise.all([
    getVqdToken(query, { region: options?.region }),
    getAntiBotCache(),
  ]);
  const signal = options?.signal ?? 'low';

  // Build URL with anti-bot tokens
  const params = new URLSearchParams({
    q: query,
    vqd,
    signal,
    upgradable: '0',
  });
  if (antiBot.dp) {
    params.set('jsa', antiBot.jsa);
    params.set('jsa_hash', antiBot.jsa_hash);
    params.set('dp', antiBot.dp);
  }
  const url = `https://${endpoint}?${params.toString()}`;

  await enforceRateLimit();

  const response = await httpPost(
    url,
    JSON.stringify(body),
    {
      ...DDG_HEADERS,
      'Content-Type': 'application/json',
    },
    15000,
  );

  if (response.status < 200 || response.status >= 300) {
    throw new DdgApiError(
      `HTTP ${response.status}: ${response.body.slice(0, 200)}`,
      response.status,
      response.body,
    );
  }

  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new DdgApiError(
      `Failed to parse JSON response: ${response.body.slice(0, 200)}`,
      response.status,
      response.body,
    );
  }
}
