/**
 * ScraperAPI Cloud Proxy — Unified Fetch Helper
 * ─────────────────────────────────────────────
 * Replaces all local Playwright/Chromium usage. ScraperAPI handles
 * IP rotation, JS rendering, and CAPTCHA solving in the cloud, so the
 * Bun runtime stays slim and memory-light (no 2 GB browser process).
 *
 *   • fetchHTML(url, opts)        → raw rendered HTML string
 *   • googleSearch(query, opts)   → structured Google SERP JSON
 *
 * All requests have a 60-second timeout (the cloud proxy needs time to
 * rotate IPs and render JS-heavy pages).
 */

const SCRAPERAPI_BASE = 'https://api.scraperapi.com';
const SCRAPERAPI_GOOGLE = 'https://api.scraperapi.com/structured/google/search';
const DEFAULT_TIMEOUT_MS = 60_000;

function getApiKey(): string {
  const key = process.env.SCRAPER_API_KEY;
  if (!key) {
    throw new Error('SCRAPER_API_KEY is not set — add it under Replit Secrets.');
  }
  return key;
}

/**
 * ScraperAPI error with HTTP status attached so the self-healing
 * wrapper can classify 403/429 → immediate IP-rotation retry.
 */
export class ScraperApiError extends Error {
  status: number;
  body?: string;
  constructor(status: number, message: string, body?: string) {
    super(message);
    this.name = 'ScraperApiError';
    this.status = status;
    this.body = body;
  }
}

export interface FetchHtmlOpts {
  /** Force JS rendering (default: true). */
  render?: boolean;
  /** Use ScraperAPI's premium residential pool (LinkedIn, Instagram, etc.). */
  premium?: boolean;
  /** ISO 3166 country code (e.g. 'us', 'gb', 'ng') for geo-targeted IPs. */
  country?: string;
  /** Override the 60s default. */
  timeoutMs?: number;
}

/**
 * Fetch a fully-rendered HTML page through ScraperAPI.
 * Throws ScraperApiError on non-2xx responses.
 */
export async function fetchHTML(url: string, opts: FetchHtmlOpts = {}): Promise<string> {
  const params = new URLSearchParams({
    api_key: getApiKey(),
    url,
    render: String(opts.render ?? true),
  });
  if (opts.premium) params.set('premium', 'true');
  if (opts.country) params.set('country_code', opts.country);

  const target = `${SCRAPERAPI_BASE}?${params.toString()}`;
  const res = await fetch(target, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ScraperApiError(
      res.status,
      `ScraperAPI returned HTTP ${res.status} for ${url}`,
      body.slice(0, 500),
    );
  }
  return await res.text();
}

/** Auto-detect whether a URL needs the premium residential pool. */
export function needsPremium(url: string): boolean {
  return /linkedin\.com|instagram\.com/i.test(url);
}

// ─── STRUCTURED GOOGLE SEARCH ───────────────────────

export interface GoogleOrganicResult {
  position: number;
  title: string;
  url: string;
  snippet: string;
}

export interface GoogleSearchOpts {
  hl?: string;
  gl?: string;
  max?: number;
  timeoutMs?: number;
}

/**
 * Query Google via ScraperAPI's structured endpoint. Returns clean
 * organic results as JSON — no HTML parsing required.
 */
export async function googleSearch(
  query: string,
  opts: GoogleSearchOpts = {},
): Promise<{ results: GoogleOrganicResult[]; count: number; httpStatus: number }> {
  const max = opts.max ?? 10;
  const params = new URLSearchParams({
    api_key: getApiKey(),
    query,
    country_code: opts.gl ?? 'us',
    num: String(Math.max(10, max)),
  });
  if (opts.hl) params.set('hl', opts.hl);

  const target = `${SCRAPERAPI_GOOGLE}?${params.toString()}`;
  const res = await fetch(target, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ScraperApiError(
      res.status,
      `ScraperAPI Google endpoint returned HTTP ${res.status}`,
      body.slice(0, 500),
    );
  }

  const data = await res.json() as any;
  const organic: any[] = Array.isArray(data?.organic_results) ? data.organic_results : [];

  const results: GoogleOrganicResult[] = organic
    .slice(0, max)
    .map((r, i) => ({
      position: typeof r.position === 'number' ? r.position : i + 1,
      title: String(r.title ?? ''),
      url: String(r.link ?? r.url ?? ''),
      snippet: String(r.snippet ?? r.description ?? ''),
    }))
    .filter((r) => r.title && r.url);

  return { results, count: results.length, httpStatus: res.status };
}
