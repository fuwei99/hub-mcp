import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DdgApiError } from './client.js';

vi.mock('./http.js', () => ({
  httpGet: vi.fn(),
}));

describe('stripJsonp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('strips ddg_spice_dictionary_definition wrapper', async () => {
    const { stripJsonp } = await import('./instant.js');
    const input =
      'ddg_spice_dictionary_definition([{"word":"hello","partOfSpeech":"interjection","text":"A greeting","sourceDictionary":"ahd-5"}])';
    const result = stripJsonp(input);
    expect(JSON.parse(result)).toEqual([
      {
        word: 'hello',
        partOfSpeech: 'interjection',
        text: 'A greeting',
        sourceDictionary: 'ahd-5',
      },
    ]);
  });

  it('strips ddg_spice_currency wrapper', async () => {
    const { stripJsonp } = await import('./instant.js');
    const input =
      'ddg_spice_currency({"from":"USD","amount":1,"timestamp":"2024-01-01","to":[{"quotecurrency":"EUR","mid":0.85}]})';
    const result = stripJsonp(input);
    expect(JSON.parse(result)).toEqual({
      from: 'USD',
      amount: 1,
      timestamp: '2024-01-01',
      to: [{ quotecurrency: 'EUR', mid: 0.85 }],
    });
  });

  it('throws DdgApiError on empty string', async () => {
    const { stripJsonp } = await import('./instant.js');
    expect(() => stripJsonp('')).toThrow(DdgApiError);
  });

  it('returns plain JSON as-is when no wrapper present', async () => {
    const { stripJsonp } = await import('./instant.js');
    const input = '[{"word":"hello"}]';
    const result = stripJsonp(input);
    expect(result).toBe(input);
  });

  it('throws DdgApiError on unclosed parentheses', async () => {
    const { stripJsonp } = await import('./instant.js');
    expect(() => stripJsonp('ddg_spice_currency({"from":"USD"')).toThrow(DdgApiError);
  });

  it('throws DdgApiError on extra characters after closing paren', async () => {
    const { stripJsonp } = await import('./instant.js');
    expect(() => stripJsonp('ddg_spice_currency({"from":"USD"})x')).toThrow(DdgApiError);
  });

  it('handles trailing semicolon (DDG JSONP format)', async () => {
    const { stripJsonp } = await import('./instant.js');
    const input = 'ddg_spice_currency({"from":"USD","amount":1,"timestamp":"","to":[{"quotecurrency":"EUR","mid":0.85}]});';
    const result = stripJsonp(input);
    const parsed = JSON.parse(result);
    expect(parsed.from).toBe('USD');
    expect(parsed.to[0].quotecurrency).toBe('EUR');
  });

  it('handles trailing semicolon with newline', async () => {
    const { stripJsonp } = await import('./instant.js');
    const input = 'ddg_spice_dictionary_definition([{"word":"hello"}]);\n';
    const result = stripJsonp(input);
    expect(JSON.parse(result)).toEqual([{ word: 'hello' }]);
  });
});

describe('getDefinition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns definitions array from JSONP response', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockResolvedValue({
      status: 200,
      body: 'ddg_spice_dictionary_definition([{"word":"hello","partOfSpeech":"interjection","text":"A greeting","sourceDictionary":"ahd-5","wordnikUrl":"https://www.wordnik.com/words/hello","attributionText":"from AHD"}])',
    });
    const { getDefinition } = await import('./instant.js');

    const result = await getDefinition('hello');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      word: 'hello',
      partOfSpeech: 'interjection',
      text: 'A greeting',
      sourceDictionary: 'ahd-5',
      wordnikUrl: 'https://www.wordnik.com/words/hello',
      attributionText: 'from AHD',
    });
  });

  it('returns empty array for unknown word', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockResolvedValue({
      status: 200,
      body: 'ddg_spice_dictionary_definition([])',
    });
    const { getDefinition } = await import('./instant.js');

    const result = await getDefinition('xyzzy');

    expect(result).toEqual([]);
  });

  it('throws DdgApiError on non-200 status', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockResolvedValue({
      status: 500,
      body: 'Internal Server Error',
    });
    const { getDefinition } = await import('./instant.js');

    await expect(getDefinition('test')).rejects.toThrow(DdgApiError);
  });

  it('bubbles up network errors', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockRejectedValue(new Error('Network failure'));
    const { getDefinition } = await import('./instant.js');

    await expect(getDefinition('test')).rejects.toThrow('Network failure');
  });
});

describe('convertCurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns conversion result from JSONP response', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockResolvedValue({
      status: 200,
      body: 'ddg_spice_currency({"from":"USD","amount":1,"timestamp":"2024-01-01T00:00:00Z","to":[{"quotecurrency":"EUR","mid":0.85}]})',
    });
    const { convertCurrency } = await import('./instant.js');

    const result = await convertCurrency(1, 'USD', 'EUR');

    expect(result).toEqual({
      from: 'USD',
      amount: 1,
      timestamp: '2024-01-01T00:00:00Z',
      to: [{ currency: 'EUR', rate: 0.85 }],
    });
  });

  it('lowercases currency codes in URL', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockResolvedValue({
      status: 200,
      body: 'ddg_spice_currency({"from":"USD","amount":1,"timestamp":"","to":[]})',
    });
    const { convertCurrency } = await import('./instant.js');

    await convertCurrency(1, 'USD', 'EUR');

    expect(httpGet).toHaveBeenCalledWith(
      expect.stringContaining('/1/usd/eur'),
      expect.anything(),
      5000,
    );
  });

  it('handles empty to array for invalid pairs', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockResolvedValue({
      status: 200,
      body: 'ddg_spice_currency({"from":"USD","amount":1,"timestamp":"2024-01-01T00:00:00Z","to":[]})',
    });
    const { convertCurrency } = await import('./instant.js');

    const result = await convertCurrency(1, 'USD', 'INVALID');

    expect(result.to).toEqual([]);
  });

  it('throws DdgApiError on non-200 status', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockResolvedValue({
      status: 400,
      body: 'Bad Request',
    });
    const { convertCurrency } = await import('./instant.js');

    await expect(convertCurrency(1, 'USD', 'EUR')).rejects.toThrow(DdgApiError);
  });

  it('bubbles up network errors', async () => {
    const { httpGet } = await import('./http.js');
    vi.mocked(httpGet).mockRejectedValue(new Error('Connection refused'));
    const { convertCurrency } = await import('./instant.js');

    await expect(convertCurrency(1, 'USD', 'EUR')).rejects.toThrow('Connection refused');
  });
});
