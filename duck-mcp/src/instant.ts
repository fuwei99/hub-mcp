import { httpGet } from './http.js';
import { DdgApiError } from './client.js';

// ─── stripJsonp ─────────────────────────────────────────────────────────

/**
 * Strip JSONP wrapper from a response body.
 *
 * Handles:
 * - Empty string → throws DdgApiError
 * - Plain JSON (no wrapper) → returns as-is
 * - Wrapped JSON (fn_name(...)) → extracts inner JSON
 * - Malformed input → throws DdgApiError
 */
export function stripJsonp(text: string): string {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    throw new DdgApiError('Empty response body');
  }

  // Try to parse as plain JSON first
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Not valid JSON — might be JSONP
  }

  // Try to strip JSONP wrapper: fn_name(...) or fn_name([...])
  // DDG responses often end with ");" — strip trailing semicolon/newline
  const match = trimmed.match(/^\w+\((.+)\);?\s*$/s);
  if (match) {
    const inner = match[1].trim();
    try {
      JSON.parse(inner);
      return inner;
    } catch {
      throw new DdgApiError('Malformed JSONP response: inner content is not valid JSON');
    }
  }

  throw new DdgApiError('Unexpected response format: not JSON or JSONP');
}

// ─── Types ──────────────────────────────────────────────────────────────

export interface Definition {
  word: string;
  partOfSpeech: string;
  text: string;
  sourceDictionary: string;
  wordnikUrl?: string;
  attributionText?: string;
}

export interface CurrencyResult {
  from: string;
  amount: number;
  timestamp: string;
  to: { currency: string; rate: number }[];
}

// ─── getDefinition ──────────────────────────────────────────────────────

/**
 * Fetch word definitions from DuckDuckGo's dictionary spice endpoint.
 *
 * Uses `/js/spice/dictionary/definition/{word}/h1` — no VQD needed.
 * Returns an array of Definition objects (may be empty for unknown words).
 */
export async function getDefinition(word: string): Promise<Definition[]> {
  const url = `https://duckduckgo.com/js/spice/dictionary/definition/${encodeURIComponent(word)}/h1`;

  const response = await httpGet(
    url,
    {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    },
    5000,
  );

  if (response.status < 200 || response.status >= 300) {
    throw new DdgApiError(
      `HTTP ${response.status}: ${response.body.slice(0, 200)}`,
      response.status,
      response.body,
    );
  }

  const data = JSON.parse(stripJsonp(response.body));

  if (!Array.isArray(data)) {
    throw new DdgApiError('Unexpected response format: expected array');
  }

  return data.map(
    (item: any) =>
      ({
        word: String(item.word ?? ''),
        partOfSpeech: String(item.partOfSpeech ?? ''),
        text: String(item.text ?? ''),
        sourceDictionary: String(item.sourceDictionary ?? ''),
        wordnikUrl: item.wordnikUrl != null ? String(item.wordnikUrl) : undefined,
        attributionText: item.attributionText != null ? String(item.attributionText) : undefined,
      }) as Definition,
  );
}

// ─── convertCurrency ────────────────────────────────────────────────────

/**
 * Fetch currency conversion rates from DuckDuckGo's currency spice endpoint.
 *
 * Uses `/js/spice/currency/{amount}/{from}/{to}` — no VQD needed.
 * Currency codes are lowercased automatically.
 */
export async function convertCurrency(
  amount: number,
  from: string,
  to: string,
): Promise<CurrencyResult> {
  const url = `https://duckduckgo.com/js/spice/currency/${amount}/${encodeURIComponent(from.toLowerCase())}/${encodeURIComponent(to.toLowerCase())}`;

  const response = await httpGet(url, {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
  }, 5000);

  if (response.status < 200 || response.status >= 300) {
    throw new DdgApiError(
      `HTTP ${response.status}: ${response.body.slice(0, 200)}`,
      response.status,
      response.body,
    );
  }

  const data = JSON.parse(stripJsonp(response.body));

  return {
    from: String(data.from ?? ''),
    amount: Number(data.amount ?? 0),
    timestamp: String(data.timestamp ?? ''),
    to: Array.isArray(data.to)
      ? data.to.map((item: any) => ({
          currency: String(item.quotecurrency ?? ''),
          rate: Number(item.mid ?? 0),
        }))
      : [],
  };
}
