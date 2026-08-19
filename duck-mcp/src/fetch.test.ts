import { describe, it, expect } from 'vitest';
import { fetchContent } from './fetch.js';

describe('URL validation', () => {
  it('rejects non-http/https protocols', async () => {
    await expect(fetchContent('ftp://bad.com')).rejects.toThrow('Invalid URL');
    await expect(fetchContent('file:///etc/passwd')).rejects.toThrow('Invalid URL');
    await expect(fetchContent('data:text/plain,hello')).rejects.toThrow('Invalid URL');
  });

  it('rejects localhost', async () => {
    await expect(fetchContent('http://localhost:3000/path')).rejects.toThrow('Invalid URL');
    await expect(fetchContent('https://localhost')).rejects.toThrow('Invalid URL');
    await expect(fetchContent('http://LOCALHOST')).rejects.toThrow('Invalid URL');
  });

  it('rejects loopback IP 127.x.x.x', async () => {
    await expect(fetchContent('http://127.0.0.1')).rejects.toThrow('Invalid URL');
    await expect(fetchContent('http://127.255.255.255')).rejects.toThrow('Invalid URL');
  });

  it('rejects private 10.x.x.x', async () => {
    await expect(fetchContent('http://10.0.0.1/test')).rejects.toThrow('Invalid URL');
    await expect(fetchContent('http://10.255.255.255')).rejects.toThrow('Invalid URL');
  });

  it('rejects private 192.168.x.x', async () => {
    await expect(fetchContent('http://192.168.1.1')).rejects.toThrow('Invalid URL');
    await expect(fetchContent('http://192.168.255.255')).rejects.toThrow('Invalid URL');
  });

  it('rejects private 172.16.0.0 - 172.31.255.255', async () => {
    await expect(fetchContent('http://172.16.0.1')).rejects.toThrow('Invalid URL');
    await expect(fetchContent('http://172.31.255.255')).rejects.toThrow('Invalid URL');
  });

  it('accepts valid https URLs', async () => {
    // Should not throw
    const result = await fetchContent('https://example.com');
    expect(result).toBeTruthy();
    expect(result.url).toMatch(/^https:\/\/example\.com/);
  });

  it('accepts valid http URLs', async () => {
    const result = await fetchContent('http://example.com');
    expect(result).toBeTruthy();
  });
});

describe('fetchContent - content extraction', () => {
  it('fetches https://example.com and extracts title', async () => {
    const result = await fetchContent('https://example.com');
    expect(result.title).toBe('Example Domain');
  });

  it('fetches https://example.com with content length > 50', async () => {
    const result = await fetchContent('https://example.com');
    expect(result.content.length).toBeGreaterThan(50);
    expect(typeof result.content).toBe('string');
  });

  it('description should be undefined if meta description missing', async () => {
    const result = await fetchContent('https://example.com');
    expect(result.description).toBeUndefined();
  });

  it('truncates content based on maxLength', async () => {
    const result = await fetchContent('https://example.com', 100);
    expect(result.content.length).toBeLessThanOrEqual(100);
  });

  it('default maxLength is 5000', async () => {
    const result = await fetchContent('https://example.com');
    expect(result.content.length).toBeLessThanOrEqual(5000);
  });
});

describe('fetchContent - content quality', () => {
  it('returns plain text without HTML tags', async () => {
    const result = await fetchContent('https://example.com');
    expect(result.content).not.toContain('<');
    expect(result.content).not.toContain('>');
  });

  it('whitespace is normalized (collapsed)', async () => {
    const result = await fetchContent('https://example.com');
    // No double spaces or newlines in the middle
    expect(result.content).not.toMatch(/\s{2,}/);
    // Should not have leading/trailing whitespace
    expect(result.content).toBe(result.content.trim());
  });
});

describe('fetchContent - error handling', () => {
  it('non-200 status throws with status code', async () => {
    await expect(
      fetchContent('https://example.com/nonexistent-page-12345')
    ).rejects.toThrow(/HTTP \d+/);
  });
});

describe('fetchContent - content type handling', () => {
  it('handles application/json by returning raw JSON text', async () => {
    const result = await fetchContent('https://jsonplaceholder.typicode.com/todos/1');
    expect(result.content.length).toBeGreaterThan(0);
    // Should be JSON string
    expect(result.content.startsWith('{') || result.content.startsWith('[')).toBe(true);
  });
});
