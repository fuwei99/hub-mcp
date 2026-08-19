import { ddgPost, DdgApiError } from './client.js';

// ─── Public interfaces ─────────────────────────────────────────────────

export interface QnaSource {
  site: string;
  text: string;
  link: string;
}

export interface QnaResult {
  answer: string;            // Short answer (Markdown)
  expandedAnswer: string;    // Expanded answer (Markdown, có thể có bảng)
  sources: QnaSource[];      // Wikipedia sources
  score: number;             // 0.0 - 1.0
}

// ─── Internal types ────────────────────────────────────────────────────

interface RawSourceArticle {
  site?: string;
  text?: string;
  link?: string;
}

interface RawSourceEntry {
  article?: RawSourceArticle;
  section?: Record<string, unknown>;
}

interface RawQnaResponse {
  answer?: string;
  expanded_answer?: string;
  sources?: RawSourceEntry[];
  score?: number;
  action?: unknown;
  sorry_reason?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Extract QnaSource[] from the raw API response sources array.
 * Filters out entries without an article or site.
 */
function parseSources(rawSources?: RawSourceEntry[]): QnaSource[] {
  if (!rawSources || !Array.isArray(rawSources)) return [];

  return rawSources
    .filter((s): s is RawSourceEntry & { article: RawSourceArticle } =>
      !!s.article && !!s.article.site,
    )
    .map((s) => ({
      site: s.article.site ?? '',
      text: s.article.text ?? '',
      link: s.article.link ?? '',
    }));
}

// ─── Main export ───────────────────────────────────────────────────────

/**
 * Gọi DuckDuckGo QnA API để lấy instant answer cho query.
 * Dùng qna.js endpoint — trả về câu trả lời AI từ Wikipedia.
 * Nếu không có answer (score thấp hoặc không có data) → trả về null.
 */
export async function getAnswer(
  query: string,
  options?: { region?: string },
): Promise<QnaResult | null> {
  const body: Record<string, unknown> = {
    q: query,
    country_code: 'US',
    dominant_result_language: 'en',
    dw: 0,
    has_ads: 0,
    trigger_version: 16,
  };

  const raw = await ddgPost<RawQnaResponse>(
    'duckduckgo.com/qna.js',
    query,
    body,
    { signal: 'low', region: options?.region },
  );

  // If API returned a sorry_reason, log warning and return null
  if (raw.sorry_reason) {
    console.warn(`QnA API returned sorry_reason: ${raw.sorry_reason}`);
    return null;
  }

  // No answer or score too low → no result
  if (!raw.answer || (raw.score ?? 0) < 0.1) {
    return null;
  }

  return {
    answer: raw.answer,
    expandedAnswer: raw.expanded_answer ?? '',
    sources: parseSources(raw.sources),
    score: raw.score ?? 0,
  };
}
