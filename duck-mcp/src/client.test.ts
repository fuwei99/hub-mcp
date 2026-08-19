import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ddgGet, ddgPost, DdgApiError, resetRateLimit } from './client.js';

const FAKE_TOKEN = vi.hoisted(() => '4-test-token-12345');

// Mock the vqd module
vi.mock('./vqd.js', () => ({
  getVqdToken: vi.fn().mockResolvedValue(FAKE_TOKEN),
  DDG_HEADERS: {
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Origin: 'https://duckduckgo.com',
    Referer: 'https://duckduckgo.com/',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    'Content-Type': 'application/x-www-form-urlencoded',
  },
}));

// Mock the http module so no real network calls happen
vi.mock('./http.js', () => ({
  httpGet: vi.fn(),
  httpPost: vi.fn(),
}));

import { httpGet, httpPost } from './http.js';
const mockHttpGet = vi.mocked(httpGet);
const mockHttpPost = vi.mocked(httpPost);

function mockJsonResponse(
  data: unknown,
) {
  return {
    status: 200,
    body: JSON.stringify(data),
    headers: { 'content-type': 'application/json' },
  };
}

function mockErrorResponse(
  status: number,
  body: string = 'Error',
) {
  return {
    status,
    body,
    headers: { 'content-type': 'text/plain' },
  };
}

// ─── DdgApiError ──────────────────────────────────────────────────────

describe('DdgApiError', () => {
  it('has name set to DdgApiError', () => {
    const err = new DdgApiError('something went wrong');
    expect(err.name).toBe('DdgApiError');
  });

  it('stores statusCode and body when provided', () => {
    const err = new DdgApiError('Not found', 404, '{"error":"not found"}');
    expect(err.message).toBe('Not found');
    expect(err.statusCode).toBe(404);
    expect(err.body).toBe('{"error":"not found"}');
  });

  it('defaults statusCode and body to undefined', () => {
    const err = new DdgApiError('generic');
    expect(err.statusCode).toBeUndefined();
    expect(err.body).toBeUndefined();
  });
});

// ─── ddgGet ───────────────────────────────────────────────────────────

describe('ddgGet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimit();
  });

  it('calls getVqdToken with the query and default region', async () => {
    const { getVqdToken } = await import('./vqd.js');
    mockHttpGet.mockResolvedValue(mockJsonResponse({ foo: 'bar' }));

    await ddgGet('links.duckduckgo.com/d.js', { q: 'hello' });

    expect(getVqdToken).toHaveBeenCalledWith('hello', { region: undefined });
  });

  it('passes region option to getVqdToken', async () => {
    const { getVqdToken } = await import('./vqd.js');
    mockHttpGet.mockResolvedValue(mockJsonResponse({ foo: 'bar' }));

    await ddgGet('links.duckduckgo.com/d.js', { q: 'test' }, { region: 'de-de' });

    expect(getVqdToken).toHaveBeenCalledWith('test', { region: 'de-de' });
  });

  it('builds the correct URL with VQD token and o=json', async () => {
    mockHttpGet.mockResolvedValue(mockJsonResponse({ results: [] }));

    await ddgGet('links.duckduckgo.com/d.js', { q: 'hello world' });

    expect(mockHttpGet).toHaveBeenCalledTimes(1);
    const [url] = mockHttpGet.mock.calls[0] as [string, Record<string, string>, number];

    expect(url).toContain('links.duckduckgo.com/d.js');
    expect(url).toContain('q=hello+world');
    expect(url).toContain(`vqd=${FAKE_TOKEN}`);
    expect(url).toContain('o=json');
  });

  it('appends extra params to the URL', async () => {
    mockHttpGet.mockResolvedValue(mockJsonResponse({ results: [] }));

    await ddgGet('links.duckduckgo.com/d.js', {
      q: 'test',
      kl: 'us-en',
      df: '2024-01',
    });

    const [url] = mockHttpGet.mock.calls[0] as [string, Record<string, string>, number];
    expect(url).toContain('kl=us-en');
    expect(url).toContain('df=2024-01');
  });

  it('sends a GET request with DDG_HEADERS', async () => {
    mockHttpGet.mockResolvedValue(mockJsonResponse({ results: [] }));

    await ddgGet('links.duckduckgo.com/d.js', { q: 'test' });

    const [, headers] = mockHttpGet.mock.calls[0] as [string, Record<string, string>, number];
    expect(headers).toEqual(
      expect.objectContaining({
        'User-Agent': expect.stringContaining('Mozilla'),
        Accept: '*/*',
        Origin: 'https://duckduckgo.com',
      }),
    );
  });

  it('returns parsed JSON response', async () => {
    const data = { results: [{ title: 'Test' }] };
    mockHttpGet.mockResolvedValue(mockJsonResponse(data));

    const result = await ddgGet<{ results: Array<{ title: string }> }>(
      'links.duckduckgo.com/d.js',
      { q: 'test' },
    );

    expect(result).toEqual(data);
  });

  it('retries on network error up to default maxRetries (2)', async () => {
    mockHttpGet
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValue(mockJsonResponse({ ok: true }));

    const result = await ddgGet('links.duckduckgo.com/d.js', { q: 'test' });

    expect(result).toEqual({ ok: true });
    expect(mockHttpGet).toHaveBeenCalledTimes(3);
  });

  it('respects custom maxRetries option', async () => {
    mockHttpGet
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue(mockJsonResponse({ ok: true }));

    const result = await ddgGet(
      'links.duckduckgo.com/d.js',
      { q: 'test' },
      { maxRetries: 1 },
    );

    expect(result).toEqual({ ok: true });
    expect(mockHttpGet).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 4xx response', async () => {
    mockHttpGet.mockResolvedValue(mockErrorResponse(400, 'Bad request'));

    await expect(
      ddgGet('links.duckduckgo.com/d.js', { q: 'test' }),
    ).rejects.toThrow(DdgApiError);

    expect(mockHttpGet).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 5xx response', async () => {
    mockHttpGet.mockResolvedValue(mockErrorResponse(503, 'Service unavailable'));

    await expect(
      ddgGet('links.duckduckgo.com/d.js', { q: 'test' }),
    ).rejects.toThrow(DdgApiError);

    expect(mockHttpGet).toHaveBeenCalledTimes(1);
  });

  it('throws DdgApiError with statusCode and body on non-ok response', async () => {
    mockHttpGet.mockResolvedValue(mockErrorResponse(429, 'Too many requests'));

    let err: unknown;
    try {
      await ddgGet('links.duckduckgo.com/d.js', { q: 'test' });
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(DdgApiError);
    if (err instanceof DdgApiError) {
      expect(err.statusCode).toBe(429);
      expect(err.body).toBe('Too many requests');
    }
  });

  it('throws DdgApiError when JSON parsing fails', async () => {
    mockHttpGet.mockResolvedValue({
      status: 200,
      body: 'not json',
      headers: { 'content-type': 'application/json' },
    });

    await expect(
      ddgGet('links.duckduckgo.com/d.js', { q: 'test' }),
    ).rejects.toThrow(DdgApiError);
  });

  it('throws DdgApiError on all retries exhausted', async () => {
    mockHttpGet.mockRejectedValue(new Error('Network down'));

    await expect(
      ddgGet('links.duckduckgo.com/d.js', { q: 'test' }, { maxRetries: 1 }),
    ).rejects.toThrow(DdgApiError);

    await expect(
      ddgGet('links.duckduckgo.com/d.js', { q: 'test' }, { maxRetries: 1 }),
    ).rejects.toThrow('Network');
  });
});

// ─── ddgPost ──────────────────────────────────────────────────────────

describe('ddgPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimit();
  });

  it('calls getVqdToken with the query and default region', async () => {
    const { getVqdToken } = await import('./vqd.js');
    mockHttpPost.mockResolvedValue(mockJsonResponse({ answer: '42' }));

    await ddgPost('duckduckgo.com/qna', 'the question', {});

    expect(getVqdToken).toHaveBeenCalledWith('the question', {
      region: undefined,
    });
  });

  it('passes region option to getVqdToken', async () => {
    const { getVqdToken } = await import('./vqd.js');
    mockHttpPost.mockResolvedValue(mockJsonResponse({ answer: '42' }));

    await ddgPost(
      'duckduckgo.com/qna',
      'test',
      {},
      { region: 'de-de' },
    );

    expect(getVqdToken).toHaveBeenCalledWith('test', { region: 'de-de' });
  });

  it('builds the correct URL with signal and upgradable', async () => {
    mockHttpPost.mockResolvedValue(mockJsonResponse({ answer: '42' }));

    await ddgPost('duckduckgo.com/qna', 'hello world', {});

    expect(mockHttpPost).toHaveBeenCalledTimes(1);
    const [url] = mockHttpPost.mock.calls[0] as [string, string, Record<string, string>, number];

    expect(url).toContain('duckduckgo.com/qna');
    expect(url).toMatch(/q=hello[\+ ]world/);
    expect(url).toContain(`vqd=${FAKE_TOKEN}`);
    expect(url).toContain('upgradable=0');
  });

  it('uses signal=low by default', async () => {
    mockHttpPost.mockResolvedValue(mockJsonResponse({ answer: '42' }));

    await ddgPost('duckduckgo.com/qna', 'test', {});

    const [url] = mockHttpPost.mock.calls[0] as [string, string, Record<string, string>, number];
    expect(url).toContain('signal=low');
  });

  it('uses signal=high when specified', async () => {
    mockHttpPost.mockResolvedValue(mockJsonResponse({ answer: '42' }));

    await ddgPost(
      'duckduckgo.com/qna',
      'test',
      {},
      { signal: 'high' },
    );

    const [url] = mockHttpPost.mock.calls[0] as [string, string, Record<string, string>, number];
    expect(url).toContain('signal=high');
  });

  it('sends POST request with JSON body and DDG_HEADERS', async () => {
    mockHttpPost.mockResolvedValue(mockJsonResponse({ answer: '42' }));

    const body = { query: 'test', someKey: 'value' };
    await ddgPost('duckduckgo.com/qna', 'test', body);

    const [, postBody, headers] = mockHttpPost.mock.calls[0] as [string, string, Record<string, string>, number];
    expect(headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        Accept: '*/*',
        Origin: 'https://duckduckgo.com',
      }),
    );
    expect(JSON.parse(postBody)).toEqual(body);
  });

  it('returns parsed JSON response', async () => {
    const data = { answer: 'The answer is 42', results: [] };
    mockHttpPost.mockResolvedValue(mockJsonResponse(data));

    const result = await ddgPost<{ answer: string; results: Array<unknown> }>(
      'duckduckgo.com/qna',
      'test',
      {},
    );

    expect(result).toEqual(data);
  });

  it('throws DdgApiError on non-ok response', async () => {
    mockHttpPost.mockResolvedValue(mockErrorResponse(403, 'Forbidden'));

    await expect(
      ddgPost('duckduckgo.com/qna', 'test', {}),
    ).rejects.toThrow(DdgApiError);
  });

  it('throws DdgApiError on JSON parse failure', async () => {
    mockHttpPost.mockResolvedValue({
      status: 200,
      body: 'bad json',
      headers: { 'content-type': 'application/json' },
    });

    await expect(
      ddgPost('duckduckgo.com/qna', 'test', {}),
    ).rejects.toThrow(DdgApiError);
  });
});

// ─── Rate Limiting ────────────────────────────────────────────────────

describe('rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimit();
  });

  it('allows a single request without delay', async () => {
    mockHttpGet.mockResolvedValue(mockJsonResponse({ ok: true }));

    const start = Date.now();
    await ddgGet('links.duckduckgo.com/d.js', { q: 'test' });
    const elapsed = Date.now() - start;

    // Single request should be fast (< 100ms ideally)
    expect(elapsed).toBeLessThan(200);
  });

  it('enforces minimum 200ms gap between successive requests', async () => {
    mockHttpGet.mockResolvedValue(mockJsonResponse({ ok: true }));

    const start = Date.now();
    await ddgGet('links.duckduckgo.com/d.js', { q: 'first' });
    await ddgGet('links.duckduckgo.com/d.js', { q: 'second' });
    const elapsed = Date.now() - start;

    // Two requests with 200ms gap: at least 200ms total
    expect(elapsed).toBeGreaterThanOrEqual(180);
  });

  it('does not delay when 200ms has already elapsed', async () => {
    mockHttpGet.mockResolvedValue(mockJsonResponse({ ok: true }));

    await ddgGet('links.duckduckgo.com/d.js', { q: 'first' });
    await new Promise((r) => setTimeout(r, 300));
    mockHttpGet.mockResolvedValue(mockJsonResponse({ ok: true }));

    const start = Date.now();
    await ddgGet('links.duckduckgo.com/d.js', { q: 'second' });
    const elapsed = Date.now() - start;

    // After 300ms pause, next request should not be delayed
    expect(elapsed).toBeLessThan(200);
  });
});
