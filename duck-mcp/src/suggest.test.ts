import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DdgApiError } from './client.js';

// Mock httpGet
vi.mock('./http.js', () => ({
  httpGet: vi.fn(),
}));

describe('getSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns suggestions array from JSON response', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockResolvedValue({
      status: 200,
      body: JSON.stringify(['hello', ['hello world', 'hello kitty', 'hello fresh']]),
    });
    const { getSuggestions } = await import('./suggest.js');

    const result = await getSuggestions('hello');

    expect(result).toEqual(['hello world', 'hello kitty', 'hello fresh']);
  });

  it('returns empty array for empty query', async () => {
    const { httpGet } = await import('./http.js');
    const { getSuggestions } = await import('./suggest.js');

    const result = await getSuggestions('');

    expect(result).toEqual([]);
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('returns empty array for whitespace-only query', async () => {
    const { httpGet } = await import('./http.js');
    const { getSuggestions } = await import('./suggest.js');

    const result = await getSuggestions('   ');

    expect(result).toEqual([]);
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('throws DdgApiError on non-200 status', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockResolvedValue({
      status: 500,
      body: 'Internal Server Error',
    });
    const { getSuggestions } = await import('./suggest.js');

    await expect(getSuggestions('test')).rejects.toThrow(DdgApiError);
  });

  it('passes region parameter as kl in the URL', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockResolvedValue({
      status: 200,
      body: JSON.stringify(['test', ['test result']]),
    });
    const { getSuggestions } = await import('./suggest.js');

    await getSuggestions('test', { region: 'de-de' });

    expect(httpGet).toHaveBeenCalledWith(
      expect.stringContaining('kl=de-de'),
      expect.anything(),
      5000,
    );
  });

  it('includes type=list in the URL', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockResolvedValue({
      status: 200,
      body: JSON.stringify(['test', ['result']]),
    });
    const { getSuggestions } = await import('./suggest.js');

    await getSuggestions('test');

    expect(httpGet).toHaveBeenCalledWith(
      expect.stringContaining('type=list'),
      expect.anything(),
      5000,
    );
  });

  it('strips JSONP wrapper if returned', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockResolvedValue({
      status: 200,
      body: 'ddg_ac(["hello", ["hello world", "hello kitty"]])',
    });
    const { getSuggestions } = await import('./suggest.js');

    const result = await getSuggestions('hello');

    expect(result).toEqual(['hello world', 'hello kitty']);
  });

  it('returns empty array when suggestions key is missing in JSON', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockResolvedValue({
      status: 200,
      body: JSON.stringify(['hello', 'not_an_array']),
    });
    const { getSuggestions } = await import('./suggest.js');

    const result = await getSuggestions('hello');

    expect(result).toEqual([]);
  });

  it('passes Accept and User-Agent headers', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockResolvedValue({
      status: 200,
      body: JSON.stringify(['test', ['result']]),
    });
    const { getSuggestions } = await import('./suggest.js');

    await getSuggestions('test');

    expect(httpGet).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        Accept: 'application/json, text/javascript, */*; q=0.01',
      }),
      5000,
    );
  });

  it('includes query parameter in URL', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockResolvedValue({
      status: 200,
      body: JSON.stringify(['hello world', ['result']]),
    });
    const { getSuggestions } = await import('./suggest.js');

    await getSuggestions('hello world');

    expect(httpGet).toHaveBeenCalledWith(
      expect.stringContaining('q=hello+world'),
      expect.anything(),
      5000,
    );
  });

  it('throws DdgApiError on invalid JSON response', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockResolvedValue({
      status: 200,
      body: 'not valid json',
    });
    const { getSuggestions } = await import('./suggest.js');

    await expect(getSuggestions('test')).rejects.toThrow(DdgApiError);
  });
});
