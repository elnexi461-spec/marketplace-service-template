/**
 * ScraperAPI Compatibility Shim
 * ─────────────────────────────
 * Drop-in replacement for the legacy mobile-proxy layer. Every existing
 * caller continues to import { proxyFetch, getProxy, getProxyExitIp } from
 * './proxy' — but under the hood we route through ScraperAPI's cloud
 * (residential rotation + JS render + CAPTCHA) instead of a self-managed
 * 4G proxy fleet. Zero changes required in scraper modules.
 *
 * Public API kept stable:
 *   • proxyFetch(url, opts)    → Response (status, ok, text(), json())
 *   • getProxy()               → ProxyConfig { url, host, port, country, ... }
 *   • getProxyExitIp()         → string (rotates per request — synthetic label)
 */

import { fetchHTML, needsPremium, ScraperApiError } from './scrapers/scraperapi';

/**
 * Thrown when ScraperAPI rejects a request because the current plan
 * doesn't grant access to that target host (LinkedIn, Instagram, etc.
 * require their "Business" tier). Handlers should translate this into
 * an HTTP 503 with a clear, actionable message instead of a generic 502.
 */
export class PlanRestrictedError extends Error {
  host: string;
  hint: string;
  constructor(host: string) {
    super(`ScraperAPI plan does not include access to ${host}`);
    this.name = 'PlanRestrictedError';
    this.host = host;
    this.hint =
      `Upgrade the ScraperAPI plan (Business tier or higher) to enable ${host} scraping. ` +
      `Other targets — Amazon, Reddit, Airbnb, Indeed, Google, generic web — work on the current plan.`;
  }
}

const PREMIUM_ONLY_HOSTS = /linkedin\.com|instagram\.com/i;

export interface ProxyConfig {
  url: string;
  host: string;
  port: number;
  user: string;
  pass: string;
  country: string;
}

export interface ProxyFetchOptions extends RequestInit {
  maxRetries?: number;
  timeoutMs?: number;
  /** Force JS rendering. Default: true (matches ScraperAPI helper). */
  render?: boolean;
  /** Force ScraperAPI premium residential pool. Default: auto-detect by host. */
  premium?: boolean;
  /** ISO-3166 country for geo-targeted exit IPs. */
  country?: string;
}

// ─── SYNTHETIC PROXY METADATA ───────────────────────
// ScraperAPI rotates IPs per request and exposes no single host:port,
// so getProxy() returns a stable descriptor that callers can log/display
// without crashing. Nothing in the codebase actually dials this URL.

const SYNTHETIC_PROXY: ProxyConfig = Object.freeze({
  url: 'https://api.scraperapi.com',
  host: 'api.scraperapi.com',
  port: 443,
  user: 'scraperapi',
  pass: '<rotating>',
  country: process.env.SCRAPERAPI_COUNTRY || 'US',
});

export function getProxy(): ProxyConfig {
  // Same shape every time — ScraperAPI handles rotation server-side.
  return SYNTHETIC_PROXY;
}

export async function getProxyExitIp(): Promise<string> {
  // ScraperAPI rotates per request; no single exit IP exists. Return a
  // descriptive label so log lines and response metadata stay readable.
  return 'scraperapi-rotating';
}

// ─── FETCH (Response-compatible) ────────────────────

function inferContentType(url: string, body: string): string {
  // ScraperAPI strips the upstream Content-Type. Recover the most common
  // cases so callers using .json() don't break.
  const trimmed = body.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'application/json; charset=utf-8';
  }
  if (/\.json($|\?)/i.test(url)) {
    return 'application/json; charset=utf-8';
  }
  return 'text/html; charset=utf-8';
}

/**
 * Fetch a URL through ScraperAPI and return a real `Response` object so
 * existing code that does `.text()`, `.json()`, `.status`, `.ok` keeps
 * working without changes.
 *
 * Retry policy mirrors src/self-healing.ts:
 *   • 401, 404 → terminal, no retry (auth/not-found are not transient)
 *   • 403, 429 → immediate retry (ScraperAPI rotates IP automatically)
 *   • other transient → linear backoff (500 ms × attempt)
 */
export async function proxyFetch(
  url: string,
  options: ProxyFetchOptions = {},
): Promise<Response> {
  const {
    maxRetries = 2,
    timeoutMs = 30_000,
    render,
    premium,
    country,
  } = options;

  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const html = await fetchHTML(url, {
        render: render ?? true,
        premium: premium ?? needsPremium(url),
        country,
        timeoutMs,
      });
      return new Response(html, {
        status: 200,
        headers: { 'content-type': inferContentType(url, html) },
      });
    } catch (err) {
      lastErr = err;
      const status = err instanceof ScraperApiError ? err.status : 0;

      // 403 against premium-only hosts is a plan-tier issue, not a transient
      // bot-block — retrying just burns credits. Surface immediately.
      if (status === 403 && PREMIUM_ONLY_HOSTS.test(url)) {
        const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
        throw new PlanRestrictedError(host);
      }

      // Terminal — don't retry
      if (status === 401 || status === 404) break;

      if (attempt < maxRetries) {
        // 403/429 → immediate retry (ScraperAPI rotates IP server-side).
        // Everything else → brief linear backoff.
        const delayMs = status === 403 || status === 429 ? 0 : 500 * (attempt + 1);
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  // Surface the failure as a Response (not a throw) so callers that do
  // `if (!response.ok)` get a clean branch instead of an unhandled exception.
  if (lastErr instanceof ScraperApiError) {
    return new Response(lastErr.body || lastErr.message, {
      status: lastErr.status,
      statusText: lastErr.message.slice(0, 120),
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  // Non-ScraperAPI errors (network, timeout) — propagate.
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`proxyFetch failed for ${url}: ${String(lastErr)}`);
}
