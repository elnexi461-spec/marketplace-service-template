/**
 * Mobile SERP Scraper — Playwright + Stealth (iPhone 14)
 * ──────────────────────────────────────────────────────
 * Headless Chromium emulating an iPhone 14, with stealth enabled,
 * image/CSS/font blocking for speed, and a 10s navigation timeout.
 *
 * Returns a structured array of organic results: { position, title, url, snippet }.
 */

import { chromium, devices, type Browser, type BrowserContext, type Page } from 'playwright';
import { addExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const stealthChromium = addExtra(chromium as any);
stealthChromium.use(StealthPlugin());

/**
 * Read mobile-proxy config from env. Returns Playwright `proxy` option
 * shape, or null when no proxy is configured. Single-proxy form:
 *   PROXY_HOST + PROXY_HTTP_PORT + PROXY_USER + PROXY_PASS
 * Pool form (round-robin, picks first):
 *   PROXY_LIST="host:port:user:pass:country;host:port:user:pass:country"
 */
function getPlaywrightProxy(): { server: string; username?: string; password?: string } | null {
  const list = process.env.PROXY_LIST;
  if (list) {
    const first = list.split(';').filter(Boolean)[0];
    if (first) {
      const [host, port, user, pass] = first.split(':');
      if (host && port) {
        return {
          server: `http://${host}:${port}`,
          username: user,
          password: pass,
        };
      }
    }
  }
  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_HTTP_PORT;
  const user = process.env.PROXY_USER;
  const pass = process.env.PROXY_PASS;
  if (host && port) {
    return {
      server: `http://${host}:${port}`,
      username: user,
      password: pass,
    };
  }
  return null;
}

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

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  const executablePath = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  _browser = await stealthChromium.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-gpu',
    ],
  });
  return _browser;
}

export async function closeSerpBrowser(): Promise<void> {
  if (_browser) {
    try { await _browser.close(); } catch { /* ignore */ }
    _browser = null;
  }
}

/**
 * Resolve a Google /url?q= redirect to the actual destination.
 */
function resolveGoogleHref(href: string): string | null {
  if (!href) return null;
  try {
    if (href.startsWith('/url?') || href.startsWith('https://www.google.com/url?')) {
      const u = new URL(href, 'https://www.google.com');
      const real = u.searchParams.get('q') || u.searchParams.get('url');
      if (real && /^https?:\/\//i.test(real)) return real;
      return null;
    }
    if (/^https?:\/\//i.test(href)) {
      const host = new URL(href).hostname.toLowerCase();
      if (host.endsWith('google.com') || host.endsWith('gstatic.com') || host.endsWith('googleusercontent.com')) {
        return null;
      }
      return href;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Scrape Google mobile SERP using Playwright with iPhone 14 emulation.
 */
export async function scrapeSerpMobile(
  query: string,
  opts: { timeoutMs?: number; max?: number; hl?: string; gl?: string } = {},
): Promise<SerpScrapeResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const max = opts.max ?? 10;
  const hl = opts.hl ?? 'en';
  const gl = opts.gl ?? 'us';

  const iPhone14 = devices['iPhone 14'];
  const ua = iPhone14.userAgent;

  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let httpStatus: number | undefined;
  const proxy = getPlaywrightProxy();

  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      ...iPhone14,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: {
        'Accept-Language': `${hl}-US,${hl};q=0.9`,
        'Sec-Ch-Ua-Mobile': '?1',
      },
      ...(proxy ? { proxy } : {}),
    });

    // Block images, CSS, fonts, and media to save bandwidth and reduce latency.
    await context.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (type === 'image' || type === 'stylesheet' || type === 'font' || type === 'media') {
        return route.abort();
      }
      return route.continue();
    });

    page = await context.newPage();

    const params = new URLSearchParams({
      q: query,
      hl,
      gl,
      num: String(Math.max(10, max)),
      pws: '0',
      nfpr: '1',
    });
    const searchUrl = `https://www.google.com/search?${params.toString()}`;

    const response = await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    httpStatus = response?.status();

    if (httpStatus && httpStatus >= 400) {
      return {
        query,
        results: [],
        count: 0,
        device: 'iPhone 14',
        used_user_agent: ua,
        http_status: httpStatus,
        error: `HTTP ${httpStatus} from Google`,
      };
    }

    // Detect Google's anti-bot CAPTCHA wall. Datacenter IPs (e.g. Replit
    // without a residential/mobile proxy) are routinely served the
    // /sorry/index reCAPTCHA challenge instead of real results.
    const finalUrl = page.url();
    if (/\/sorry\/index/i.test(finalUrl)) {
      return {
        query,
        results: [],
        count: 0,
        device: 'iPhone 14',
        used_user_agent: ua,
        http_status: httpStatus,
        error: proxy
          ? 'Google served a CAPTCHA challenge even via the configured proxy — try a residential/mobile proxy.'
          : 'Google served a CAPTCHA challenge (datacenter IP detected). Configure a residential/mobile proxy via PROXY_HOST/PROXY_HTTP_PORT/PROXY_USER/PROXY_PASS or PROXY_LIST.',
      };
    }

    // Extract organic results in-page. Mobile Google wraps each organic
    // result as a top-level <a href="..."> with a <h3> inside, followed by
    // a snippet block. We collect every such link, dedupe, and skip
    // Google-internal links via resolveGoogleHref().
    const raw = await page.evaluate((maxResults) => {
      type R = { href: string; title: string; snippet: string };
      const out: R[] = [];

      const anchors = Array.from(document.querySelectorAll('a[href]'));
      for (const a of anchors) {
        if (out.length >= maxResults * 3) break;
        const href = (a as HTMLAnchorElement).getAttribute('href') || '';
        if (!href) continue;

        const h3 = a.querySelector('h3');
        if (!h3) continue;
        const title = (h3.textContent || '').trim();
        if (!title || title.length < 3) continue;

        // Walk up to find the result container, then find a snippet sibling.
        let snippet = '';
        let container: Element | null = a;
        for (let depth = 0; depth < 6 && container; depth++) {
          container = container.parentElement;
          if (!container) break;

          // Common mobile snippet selectors.
          const cand = container.querySelector(
            'div.VwiC3b, div.MUxGbd, div[data-sncf="1"], div.BNeawe.s3v9rd.AP7Wnd, div.BNeawe.tAd8D.AP7Wnd, div.kCrYT > div, span.aCOpRe, div.Hdw6tb',
          );
          if (cand) {
            const txt = (cand.textContent || '').trim();
            if (txt && txt !== title && txt.length > 10) {
              snippet = txt;
              break;
            }
          }
        }

        out.push({ href, title, snippet });
      }
      return out;
    }, max);

    const seen = new Set<string>();
    const results: SerpOrganicResult[] = [];
    for (const r of raw) {
      const url = resolveGoogleHref(r.href);
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      results.push({
        position: results.length + 1,
        title: r.title,
        url,
        snippet: r.snippet,
      });
      if (results.length >= max) break;
    }

    return {
      query,
      results,
      count: results.length,
      device: 'iPhone 14',
      used_user_agent: ua,
      http_status: httpStatus,
    };
  } catch (err: any) {
    return {
      query,
      results: [],
      count: 0,
      device: 'iPhone 14',
      used_user_agent: ua,
      http_status: httpStatus,
      error: err?.message || String(err),
    };
  } finally {
    try { await page?.close(); } catch { /* ignore */ }
    try { await context?.close(); } catch { /* ignore */ }
  }
}
