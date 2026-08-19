import { request, ProxyAgent, type Dispatcher } from 'undici';

// ─── Proxy Support ────────────────────────────────────────────────────

let proxyAgent: ProxyAgent | null = null;
let proxyUrlUsed: string | null = null;

/**
 * Get or create a shared ProxyAgent based on environment variables.
 * Respects HTTPS_PROXY, HTTP_PROXY, ALL_PROXY (in that order).
 */
function getProxyAgent(): ProxyAgent | null {
  const proxyUrl = process.env.HTTPS_PROXY
    ?? process.env.HTTP_PROXY
    ?? process.env.ALL_PROXY;

  if (!proxyUrl) return null;

  // Return cached agent if proxy hasn't changed
  if (proxyAgent && proxyUrlUsed === proxyUrl) return proxyAgent;

  // Clean up old agent
  if (proxyAgent) {
    try { proxyAgent.close(); } catch { /* ignore */ }
  }

  proxyUrlUsed = proxyUrl;
  proxyAgent = new ProxyAgent(proxyUrl);
  return proxyAgent;
}

/** Reset proxy agent (useful for testing). */
export function resetHttpClient(): void {
  if (proxyAgent) {
    try { proxyAgent.close(); } catch { /* ignore */ }
  }
  proxyAgent = null;
  proxyUrlUsed = null;
}

// ─── HTTP Response ─────────────────────────────────────────────────────

export interface HttpResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

// ─── Core HTTP Functions ───────────────────────────────────────────────

/**
 * Make an HTTP(S) GET request.
 * Uses undici with proxy support if proxy env vars are set.
 * Falls back to global fetch if no proxy.
 */
export async function httpGet(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 15000,
): Promise<HttpResponse> {
  const proxy = getProxyAgent();

  if (proxy) {
    return httpRequestWithProxy(url, 'GET', headers, undefined, timeoutMs, proxy);
  }

  // Fallback to global fetch
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    const body = await response.text();
    const respHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => { respHeaders[key.toLowerCase()] = value; });

    return {
      status: response.status,
      body,
      headers: respHeaders,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Make an HTTP(S) POST request.
 * Uses undici with proxy support if proxy env vars are set.
 * Falls back to global fetch if no proxy.
 */
export async function httpPost(
  url: string,
  body: string,
  headers: Record<string, string> = {},
  timeoutMs = 15000,
): Promise<HttpResponse> {
  const proxy = getProxyAgent();

  if (proxy) {
    return httpRequestWithProxy(url, 'POST', headers, body, timeoutMs, proxy);
  }

  // Fallback to global fetch
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...headers,
      },
      body,
      signal: controller.signal,
    });

    const respBody = await response.text();
    const respHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => { respHeaders[key.toLowerCase()] = value; });

    return {
      status: response.status,
      body: respBody,
      headers: respHeaders,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Undici Proxy Implementation ───────────────────────────────────────

async function httpRequestWithProxy(
  url: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
  proxy: ProxyAgent,
): Promise<HttpResponse> {
  const reqHeaders: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    ...headers,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await request(url, {
      method,
      headers: reqHeaders,
      body: body,
      dispatcher: proxy,
      signal: controller.signal,
    });

    const responseBody = await res.body.text();
    const respHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(res.headers)) {
      if (typeof value === 'string') {
        respHeaders[key.toLowerCase()] = value;
      }
    }

    return {
      status: res.statusCode,
      body: responseBody,
      headers: respHeaders,
    };
  } finally {
    clearTimeout(timeout);
  }
}
