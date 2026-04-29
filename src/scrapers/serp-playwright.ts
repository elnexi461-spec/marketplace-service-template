/**
 * Mobile SERP Scraper — ScraperAPI Structured Google Endpoint
 * ──────────────────────────────────────────────────────────
 * Fully cloud-native. Uses ScraperAPI's `/structured/google/search`
 * endpoint which returns JSON organic results — no HTML parsing,
 * no local browser, no CAPTCHA churn.
 *
 * File name retained as `serp-playwright.ts` so existing imports in
 * src/service.ts keep working without changes.
 */

import { googleSearch, ScraperApiError } from './scraperapi';

export interface SerpOrganicResult {
  position: number;
  title: string;
  url: string;
  snippet: string;
}

export interface SerpScrapeResult {
  query: string;
  results: SerpOrganicResult[];
  count: number;
  device: string;
  used_user_agent: string;
  http_status?: number;
  error?: string;
}

const PROXY_UA_LABEL = 'scraperapi/google-structured';

export async function scrapeSerpMobile(
  query: string,
  opts: { timeoutMs?: number; max?: number; hl?: string; gl?: string } = {},
): Promise<SerpScrapeResult> {
  try {
    const { results, count, httpStatus } = await googleSearch(query, {
      hl: opts.hl,
      gl: opts.gl,
      max: opts.max,
      timeoutMs: opts.timeoutMs ?? 60_000,
    });
    return {
      query,
      results,
      count,
      device: 'mobile',
      used_user_agent: PROXY_UA_LABEL,
      http_status: httpStatus,
    };
  } catch (err: any) {
    const status = err instanceof ScraperApiError ? err.status : undefined;
    return {
      query,
      results: [],
      count: 0,
      device: 'mobile',
      used_user_agent: PROXY_UA_LABEL,
      http_status: status,
      error: err?.message || String(err),
    };
  }
}
