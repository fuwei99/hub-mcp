import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getAnswer } from './qna.js';

// ─── Mocks ─────────────────────────────────────────────────────────────

const mockDdgPost = vi.hoisted(() => vi.fn());

vi.mock('./client.js', () => ({
  ddgPost: mockDdgPost,
  DdgApiError: class DdgApiError extends Error {
    name = 'DdgApiError';
    statusCode?: number;
    body?: string;
    constructor(message: string, statusCode?: number, body?: string) {
      super(message);
      this.statusCode = statusCode;
      this.body = body;
    }
  },
}));

// ─── Tests ──────────────────────────────────────────────────────────────

describe('getAnswer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls ddgPost with qna.js endpoint and correct body', async () => {
    mockDdgPost.mockResolvedValue({
      answer: '**Google** is a search engine',
      expanded_answer: 'Detailed info...',
      sources: [
        {
          article: {
            site: 'Wikipedia',
            text: 'Google is a search engine',
            link: 'https://en.wikipedia.org/Google',
          },
          section: {},
        },
      ],
      score: 0.2,
    });

    const result = await getAnswer('google');

    expect(mockDdgPost).toHaveBeenCalledWith(
      'duckduckgo.com/qna.js',
      'google',
      {
        q: 'google',
        country_code: 'US',
        dominant_result_language: 'en',
        dw: 0,
        has_ads: 0,
        trigger_version: 16,
      },
      { signal: 'low', region: undefined },
    );
    expect(result).not.toBeNull();
  });

  it('returns QnaResult with correctly mapped fields', async () => {
    mockDdgPost.mockResolvedValue({
      answer: '**Google** is a search engine',
      expanded_answer: '## Details\n\nGoogle was founded in 1998.',
      sources: [
        {
          article: {
            site: 'Wikipedia',
            text: 'Google is a search engine',
            link: 'https://en.wikipedia.org/Google',
          },
          section: {},
        },
      ],
      score: 0.85,
    });

    const result = await getAnswer('google');

    expect(result).toEqual({
      answer: '**Google** is a search engine',
      expandedAnswer: '## Details\n\nGoogle was founded in 1998.',
      sources: [
        {
          site: 'Wikipedia',
          text: 'Google is a search engine',
          link: 'https://en.wikipedia.org/Google',
        },
      ],
      score: 0.85,
    });
  });

  it('passes region option to ddgPost', async () => {
    mockDdgPost.mockResolvedValue({
      answer: 'Test answer',
      expanded_answer: '',
      sources: [],
      score: 0.5,
    });

    await getAnswer('test', { region: 'de-de' });

    expect(mockDdgPost).toHaveBeenCalledWith(
      'duckduckgo.com/qna.js',
      'test',
      expect.any(Object),
      { signal: 'low', region: 'de-de' },
    );
  });

  it('returns null when score is below 0.1', async () => {
    mockDdgPost.mockResolvedValue({
      answer: 'Low score answer',
      expanded_answer: '',
      sources: [],
      score: 0.05,
    });

    const result = await getAnswer('test');
    expect(result).toBeNull();
  });

  it('returns null when answer field is missing', async () => {
    mockDdgPost.mockResolvedValue({
      expanded_answer: '',
      sources: [],
      score: 0.5,
    });

    const result = await getAnswer('test');
    expect(result).toBeNull();
  });

  it('returns null when sorry_reason is present', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockDdgPost.mockResolvedValue({
      sorry_reason: 'No results found',
      answer: 'Sorry...',
      score: 0.0,
    });

    const result = await getAnswer('test');
    expect(result).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

  it('handles empty sources array', async () => {
    mockDdgPost.mockResolvedValue({
      answer: '**Answer**',
      expanded_answer: 'Expanded',
      sources: [],
      score: 0.5,
    });

    const result = await getAnswer('test');
    expect(result).not.toBeNull();
    expect(result!.sources).toEqual([]);
  });

  it('parses multiple sources correctly', async () => {
    mockDdgPost.mockResolvedValue({
      answer: '**Answer**',
      expanded_answer: 'Expanded',
      sources: [
        {
          article: { site: 'Site1', text: 'Text1', link: 'https://site1.com' },
          section: {},
        },
        {
          article: { site: 'Site2', text: 'Text2', link: 'https://site2.com' },
          section: {},
        },
      ],
      score: 0.9,
    });

    const result = await getAnswer('test');
    expect(result!.sources).toHaveLength(2);
    expect(result!.sources[0]).toEqual({
      site: 'Site1',
      text: 'Text1',
      link: 'https://site1.com',
    });
    expect(result!.sources[1]).toEqual({
      site: 'Site2',
      text: 'Text2',
      link: 'https://site2.com',
    });
  });

  it('filters out sources without article field', async () => {
    mockDdgPost.mockResolvedValue({
      answer: '**Answer**',
      expanded_answer: 'Expanded',
      sources: [
        { article: { site: 'Site1', text: 'Text1', link: 'https://site1.com' }, section: {} },
        { section: {} },
        { article: { site: 'Site3', text: 'Text3', link: 'https://site3.com' }, section: {} },
      ],
      score: 0.7,
    });

    const result = await getAnswer('test');
    expect(result!.sources).toHaveLength(2);
  });

  it('uses score 0 when score field is missing', async () => {
    mockDdgPost.mockResolvedValue({
      answer: '**Answer**',
      expanded_answer: 'Expanded',
      sources: [],
    });

    const result = await getAnswer('test');
    expect(result).toBeNull(); // because score defaults to 0 which is < 0.1
  });

  it('throws DdgApiError when ddgPost fails', async () => {
    const { DdgApiError } = await import('./client.js');
    mockDdgPost.mockRejectedValue(
      new DdgApiError('HTTP 500', 500, 'Server error'),
    );

    await expect(getAnswer('test')).rejects.toThrow('HTTP 500');
  });
});
