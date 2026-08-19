import { describe, it, expect, vi, beforeEach } from 'vitest';
import { videoSearch } from './videos.js';

// ─── Mocks ──────────────────────────────────────────────────────────────

vi.mock('./client.js', () => ({
  ddgGet: vi.fn(),
}));

import { ddgGet } from './client.js';

const mockDdgGet = vi.mocked(ddgGet);

// ─── Sample data ────────────────────────────────────────────────────────

const sampleRawResponse = {
  results: [
    {
      content: 'https://www.youtube.com/watch?v=abc123',
      description: 'A test video about AI',
      duration: '10:30',
      embed_html: '<iframe src="..."></iframe>',
      embed_url: 'https://www.youtube.com/embed/abc123',
      images: {
        large: { url: 'https://img.youtube.com/vi/abc123/hqdefault.jpg', height: 360, width: 480 },
        medium: { url: 'https://img.youtube.com/vi/abc123/mqdefault.jpg', height: 180, width: 320 },
        small: { url: 'https://img.youtube.com/vi/abc123/default.jpg', height: 90, width: 120 },
      },
      provider: 'youtube',
      published: '2024-01-15',
      publisher: 'Tech Channel',
      statistics: '1.2M views',
      title: 'AI Explained - Full Guide',
      uploader: 'Tech Guru',
    },
    {
      content: 'https://www.youtube.com/watch?v=def456',
      description: '',
      duration: '',
      images: {},
      provider: 'youtube',
      published: '',
      publisher: '',
      statistics: '',
      title: 'Second Video',
      uploader: 'Another Creator',
    },
  ],
};

const emptyResponse = { results: [] };

// ─── Tests ──────────────────────────────────────────────────────────────

describe('videoSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return parsed video results', async () => {
    mockDdgGet.mockResolvedValue(sampleRawResponse);

    const results = await videoSearch('AI tutorial');

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'AI Explained - Full Guide',
      url: 'https://www.youtube.com/watch?v=abc123',
      description: 'A test video about AI',
      duration: '10:30',
      embedUrl: 'https://www.youtube.com/embed/abc123',
      provider: 'youtube',
      publisher: 'Tech Channel',
      published: '2024-01-15',
      uploader: 'Tech Guru',
      statistics: '1.2M views',
      imageUrl: 'https://img.youtube.com/vi/abc123/hqdefault.jpg',
    });
  });

  it('should return empty array when no results', async () => {
    mockDdgGet.mockResolvedValue(emptyResponse);

    const results = await videoSearch('zzzznonexistent');
    expect(results).toHaveLength(0);
  });

  it('should handle malformed response gracefully', async () => {
    mockDdgGet.mockResolvedValue({});

    const results = await videoSearch('test');
    expect(results).toHaveLength(0);
  });

  it('should limit results to maxResults', async () => {
    const manyResults = {
      results: Array.from({ length: 20 }, (_, i) => ({
        content: `https://example.com/video${i}`,
        title: `Video ${i}`,
        description: `Desc ${i}`,
        duration: `${i}:00`,
        images: { large: { url: `https://img.example.com/${i}.jpg`, height: 360, width: 480 } },
      })),
    };
    mockDdgGet.mockResolvedValue(manyResults);

    const results = await videoSearch('test', { maxResults: 5 });
    expect(results).toHaveLength(5);
  });

  it('should filter results without content or title', async () => {
    const partialResults = {
      results: [
        { content: '', title: 'No URL' },
        { content: 'https://example.com/v', title: '' },
        { content: 'https://example.com/valid', title: 'Valid Video', description: 'Good' },
      ],
    };
    mockDdgGet.mockResolvedValue(partialResults);

    const results = await videoSearch('test');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Valid Video');
  });

  it('should prefer large image, fallback to medium/small', async () => {
    // Only small image available
    const noLarge = {
      results: [
        {
          content: 'https://example.com/v',
          title: 'No Large Img',
          images: {
            small: { url: 'https://img.example.com/small.jpg', height: 90, width: 120 },
          },
        },
      ],
    };
    mockDdgGet.mockResolvedValue(noLarge);

    const results = await videoSearch('test');
    expect(results[0].imageUrl).toBe('https://img.example.com/small.jpg');

    // No images at all
    const noImages = {
      results: [
        {
          content: 'https://example.com/v',
          title: 'No Images',
        },
      ],
    };
    mockDdgGet.mockResolvedValue(noImages);

    const results2 = await videoSearch('test');
    expect(results2[0].imageUrl).toBe('');
  });

  it('should pass region and safesearch params', async () => {
    mockDdgGet.mockResolvedValue(sampleRawResponse);

    await videoSearch('test', {
      region: 'vn-vi',
      safesearch: 'on',
    });

    expect(mockDdgGet).toHaveBeenCalledWith(
      'duckduckgo.com/v.js',
      expect.objectContaining({
        q: 'test',
        l: 'vn-vi',
        p: '1',
      }),
    );
  });

  it('should build filter string from resolution, duration, license, timeFilter', async () => {
    mockDdgGet.mockResolvedValue(sampleRawResponse);

    await videoSearch('test', {
      resolution: 'high',
      duration: 'short',
      license: 'free',
      timeFilter: 'day',
    });

    expect(mockDdgGet).toHaveBeenCalledWith(
      'duckduckgo.com/v.js',
      expect.objectContaining({
        f: 'videoDefinition:high,videoDuration:short,videoLicense:free,publishedAfter:d',
      }),
    );
  });
});
