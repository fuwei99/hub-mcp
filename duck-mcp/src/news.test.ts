import { describe, it, expect, beforeEach, vi } from 'vitest';
import { newsSearch } from './news.js';
import type { NewsItem } from './news.js';

// Mock ddgGet from client module
const mockDdgGet = vi.hoisted(() => vi.fn());
vi.mock('./client.js', () => ({
  ddgGet: mockDdgGet,
  DdgApiError: class DdgApiError extends Error {
    constructor(message: string, public readonly statusCode?: number, public readonly body?: string) {
      super(message);
      this.name = 'DdgApiError';
    }
  },
}));

// Sample DDG news.js JSON response
function buildNewsJson(items: { title: string; url: string; excerpt: string; source?: string; date?: number; image?: string }[]): string {
  return JSON.stringify({
    results: items.map((item) => ({
      title: item.title,
      url: item.url,
      excerpt: item.excerpt,
      source: item.source ?? 'Example News',
      date: item.date ?? 1700000000,
      image: item.image,
      relative_time: item.date ? undefined : '2 hours ago',
    })),
    query: 'test',
    response_type: 'news',
  });
}

const sampleJson = buildNewsJson([
  {
    title: 'AI Breakthrough in Quantum Computing',
    url: 'https://example.com/ai-quantum',
    excerpt: 'Researchers achieve major milestone in <b>quantum</b> machine learning.',
    source: 'TechCrunch',
    date: 1781752881,
    image: 'https://example.com/img1.jpg',
  },
  {
    title: 'New Programming Language Released',
    url: 'https://example.com/new-lang',
    excerpt: 'A new systems programming language promises <b>faster</b> compilation.',
    source: 'Hacker News',
  },
]);

describe('newsSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDdgGet.mockResolvedValue(JSON.parse(sampleJson));
  });

  it('calls ddgGet with duckduckgo.com/news.js endpoint', async () => {
    await newsSearch('technology');

    expect(mockDdgGet).toHaveBeenCalledTimes(1);
    const [endpoint, params] = mockDdgGet.mock.calls[0];
    expect(endpoint).toBe('duckduckgo.com/news.js');
    expect(params.q).toBe('technology');
  });

  it('returns mapped NewsItem array from JSON response', async () => {
    const results = await newsSearch('technology');

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('AI Breakthrough in Quantum Computing');
    expect(results[0].url).toBe('https://example.com/ai-quantum');
    expect(results[0].snippet).toContain('quantum');
    expect(results[0].source).toBe('TechCrunch');
    expect(results[0].image).toBe('https://example.com/img1.jpg');
    expect(results[0].date).toBeTruthy();

    expect(results[1].title).toBe('New Programming Language Released');
    expect(results[1].url).toBe('https://example.com/new-lang');
    expect(results[1].source).toBe('Hacker News');
  });

  it('strips HTML tags from excerpt', async () => {
    const results = await newsSearch('technology');
    expect(results[0].snippet).not.toContain('<b>');
    expect(results[0].snippet).not.toContain('</b>');
  });

  it('limits results to default maxResults of 5', async () => {
    const manyItems = Array.from({ length: 10 }, (_, i) => ({
      title: `Article ${i + 1}`,
      url: `https://example.com/article${i + 1}`,
      excerpt: `Snippet ${i + 1}`,
    }));
    mockDdgGet.mockResolvedValue(JSON.parse(buildNewsJson(manyItems)));

    const results = await newsSearch('technology');

    expect(results).toHaveLength(5);
  });

  it('respects custom maxResults parameter', async () => {
    const manyItems = Array.from({ length: 10 }, (_, i) => ({
      title: `Article ${i + 1}`,
      url: `https://example.com/article${i + 1}`,
      excerpt: `Snippet ${i + 1}`,
    }));
    mockDdgGet.mockResolvedValue(JSON.parse(buildNewsJson(manyItems)));

    const results = await newsSearch('technology', { maxResults: 3 });

    expect(results).toHaveLength(3);
  });

  it('returns empty array for empty results', async () => {
    mockDdgGet.mockResolvedValue({ results: [], query: 'test' });

    const results = await newsSearch('technology');
    expect(results).toEqual([]);
  });

  it('returns empty array for empty query', async () => {
    const results = await newsSearch('   ');
    expect(results).toEqual([]);
  });

  it('returns empty array when results field is missing', async () => {
    mockDdgGet.mockResolvedValue({ query: 'test' });

    const results = await newsSearch('technology');
    expect(results).toEqual([]);
  });

  it('includes region when specified', async () => {
    await newsSearch('technology', { region: 'vn-vi' });

    const [, params] = mockDdgGet.mock.calls[0];
    expect(params.l).toBe('vn-vi');
  });

  it('exports NewsItem interface with correct shape', () => {
    const item: NewsItem = {
      title: 'Test',
      url: 'https://test.com',
      source: 'Test',
      date: '2024-01-01',
      snippet: 'Test snippet',
    };
    expect(item.title).toBe('Test');
    expect(item.url).toBe('https://test.com');
    expect(item.source).toBe('Test');
    expect(item.date).toBe('2024-01-01');
    expect(item.snippet).toBe('Test snippet');
    expect(item.image).toBeUndefined();
  });
});
