import https from 'https';
import http from 'http';

// Chrome 134+ compatible cipher suite order
// This mimics browser TLS fingerprint to avoid bot detection
const CHROME_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':');

let agent: https.Agent | null = null;

/**
 * Returns a singleton https.Agent with Chrome-like TLS fingerprint.
 * Reuses the same agent across requests for connection pooling.
 */
export function getBrowserAgent(): https.Agent {
  if (!agent) {
    agent = new https.Agent({
      ciphers: CHROME_CIPHERS,
      ecdhCurve: 'X25519:prime256v1:secp384r1',
      minVersion: 'TLSv1.2' as any,
      honorCipherOrder: true,
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 8,
    });
  }
  return agent;
}

/**
 * Make an HTTP(S) GET request with browser-like TLS fingerprint.
 * Returns raw response (status, headers, body as string).
 */
export function tlsFetch(
  url: string,
  options?: {
    timeout?: number;
    headers?: Record<string, string>;
    maxRedirects?: number;
  },
): Promise<{ status: number; body: string; redirected: boolean; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const timeout = options?.timeout ?? 15000;
    const maxRedirects = options?.maxRedirects ?? 5;
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(options?.headers ?? {}),
    };

    const reqOptions: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers,
      timeout,
    };

    if (isHttps) {
      (reqOptions as https.RequestOptions).agent = getBrowserAgent();
    }

    const protocol = isHttps ? https : http;

    const req = protocol.request(reqOptions, (res) => {
      const status = res.statusCode ?? 500;
      const location = res.headers.location;

      // Handle redirects
      if (status >= 300 && status < 400 && location && maxRedirects > 0) {
        const redirectUrl = new URL(location, url).href;
        // Clean up the request
        res.resume();
        // Follow redirect recursively
        tlsFetch(redirectUrl, { ...options, maxRedirects: maxRedirects - 1 })
          .then((result) => resolve({ ...result, finalUrl: redirectUrl }))
          .catch(reject);
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve({
          status,
          body,
          redirected: status >= 300 && status < 400,
          finalUrl: url,
        });
      });
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
        reject(new Error('Request timeout'));
      } else {
        reject(err);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Resets the TLS agent (useful for testing).
 */
export function resetTlsAgent(): void {
  if (agent) {
    agent.destroy();
    agent = null;
  }
}
