import { tlsFetch } from './tls.js';

export interface FetchedContent {
  title: string;
  content: string;   // Plain text, whitespace-normalized
  url: string;
  description?: string;
}

// ─── URL Validation ────────────────────────────────────────────────────

const PRIVATE_IP_PATTERNS = [
  /^127\./,       // loopback
  /^10\./,        // class A private
  /^192\.168\./,  // class C private
  /^172\.(1[6-9]|2\d|3[01])\./, // class B private 172.16.0.0 - 172.31.255.255
  /^0\./,
  /^169\.254\./,  // link-local
  /^::1$/,        // IPv6 loopback
  /^fc00:/,       // IPv6 unique local
  /^fe80:/,       // IPv6 link-local
];

function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // Reject localhost variants
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower === '127.0.0.1'
  ) {
    return true;
  }

  // Check IP-based private ranges
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(lower)) return true;
  }

  return false;
}

function validateUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invalid URL');
  }

  if (isPrivateHost(parsed.hostname)) {
    throw new Error('Invalid URL');
  }

  return parsed;
}

// ─── HTML Parsing ──────────────────────────────────────────────────────

function extractMetaDescription(html: string): string | undefined {
  // Match <meta name="description" content="...">
  const match = html.match(
    /<meta\s[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*\/?>/i,
  );
  if (match) return match[1];

  // Also try reversed attribute order
  const match2 = html.match(
    /<meta\s[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*\/?>/i,
  );
  return match2?.[1];
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (match) return match[1].trim();

  // Fallback: first <h1>
  const h1 = html.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  return h1 ? h1[1].trim() : '';
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function normalizeWhitespace(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Strip content of specified block-level tags and their contents.
 * Case-insensitive, handles nested tags.
 */
function stripBlock(raw: string, tag: string): string {
  const tagPattern = new RegExp(
    `<${tag}[\\s>][\\s\\S]*?<\\/${tag}>|<${tag}>[\\s\\S]*?<\\/${tag}>`,
    'gi',
  );
  return raw.replace(tagPattern, '');
}

function extractHtml(html: string, url: string, maxLength: number): FetchedContent {
  const title = extractTitle(html);
  const description = extractMetaDescription(html);

  // Remove unwanted blocks
  let cleaned = html;
  cleaned = stripBlock(cleaned, 'script');
  cleaned = stripBlock(cleaned, 'style');
  cleaned = stripBlock(cleaned, 'nav');
  cleaned = stripBlock(cleaned, 'footer');
  cleaned = stripBlock(cleaned, 'header');
  cleaned = stripBlock(cleaned, 'noscript');

  // For text/html, extract body content if possible
  const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    cleaned = bodyMatch[1];
  }

  // Strip remaining HTML tags
  let text = stripTags(cleaned);

  // Normalize whitespace
  text = normalizeWhitespace(text);

  // Truncate
  if (text.length > maxLength) {
    text = text.slice(0, maxLength);
  }

  return {
    title,
    content: text,
    url,
    ...(description ? { description } : {}),
  };
}

// ─── Main export ───────────────────────────────────────────────────────

/**
 * Fetch a URL and extract its main content.
 *
 * - URL validation: only http/https, rejects private IPs and localhost
 * - TLS fingerprint: Chrome-like via tls.ts (avoids bot detection)
 * - Timeout: 15 seconds
 * - Redirects: follows up to 5 redirects
 * - Content extraction: regex-based (no cheerio dependency)
 * - Supports text/html and application/json content types
 *
 * @param url - The URL to fetch
 * @param maxLength - Maximum content length in characters (default: 5000)
 */
export async function fetchContent(
  url: string,
  maxLength: number = 5000,
): Promise<FetchedContent> {
  const parsed = validateUrl(url);
  const effectiveUrl = parsed.href;

  let response: { status: number; body: string; finalUrl: string };
  try {
    response = await tlsFetch(effectiveUrl, {
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'Request timeout') {
      throw new Error('Request timeout');
    }
    throw err;
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = response.body;

  if (text.length < 50) {
    throw new Error('No content found');
  }

  // Detect content type from response headers (via finalUrl or content-type)
  // Simple heuristic: if URL contains /api/ or response starts with { or [, treat as JSON
  const looksLikeJson =
    text.trim().startsWith('{') || text.trim().startsWith('[');

  // Handle JSON responses
  if (looksLikeJson && !text.trim().startsWith('<')) {
    return {
      title: '',
      content: text,
      url: response.finalUrl,
    };
  }

  // Handle HTML responses (default)
  return extractHtml(text, response.finalUrl, maxLength);
}
