// ─── DdgApiError ──────────────────────────────────────────────────────

export class DdgApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'DdgApiError';
  }
}
