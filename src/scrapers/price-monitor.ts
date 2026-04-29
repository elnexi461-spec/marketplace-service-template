/**
 * E-Commerce Price & Stock Monitor — Playwright Scraper
 * ─────────────────────────────────────────────────────
 * Headless mobile Chromium with stealth, image+CSS blocking,
 * 5s timeout, and a self-heal retry with a different mobile UA.
 *
 * Returns a normalized PriceSnapshot for Amazon, eBay, and a
 * generic JSON-LD / OpenGraph fallback for other sites.
 */

// Memory-efficient: playwright-core is a slim runtime (no bundled browser
// download). We pair it with playwright-extra's stealth plugin and pass
// `--single-process` to Chromium so the whole pipeline fits comfortably
// on 2 GB devices.
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { addExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const stealthChromium = addExtra(chromium as any);
stealthChromium.use(StealthPlugin());

// ─── TYPES ──────────────────────────────────────────

export interface PriceSnapshot {
  product_name: string;
  current_price: number | null;
  currency: string;
  in_stock: boolean;
  timestamp: string;
}

export interface ScrapeResult {
  snapshot: PriceSnapshot | null;
  source: 'amazon' | 'ebay' | 'generic';
  url: string;
  attempts: number;
  used_user_agent: string;
  error?: string;
  http_status?: number;
}

// ─── MOBILE USER AGENTS ─────────────────────────────

const MOBILE_USER_AGENTS = [
  // iPhone Safari
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  // Pixel 8 Chrome
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36',
  // Samsung Galaxy S24
  'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
];

const MOBILE_VIEWPORTS = [
  { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, // iPhone 14
  { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true }, // Pixel 8
  { width: 360, height: 800, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, // Galaxy S24
];

// ─── BROWSER POOL (singleton) ───────────────────────

let _browser: Browser | null = null;
let _launching: Promise<Browser> | null = null;
let _launchFailures = 0;
const MAX_LAUNCH_FAILURES = 3;

async function launchBrowser(): Promise<Browser> {
  const executablePath = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  const browser = await stealthChromium.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-gpu',
      // Memory-efficient single-process mode for 2 GB RAM devices.
      '--single-process',
      '--no-zygote',
      '--disable-extensions',
      '--disable-background-networking',
    ],
  });
  // Auto-recover when the browser process crashes — next getBrowser() call
  // will see _browser === null and relaunch.
  browser.on('disconnected', () => {
    if (_browser === browser) {
      console.warn('[price-monitor] Chromium disconnected — pool will relaunch on next request');
      _browser = null;
    }
  });
  return browser;
}

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  // De-dupe concurrent launches — important on cold start / after a crash.
  if (_launching) return _launching;

  _launching = (async () => {
    try {
      const browser = await launchBrowser();
      _browser = browser;
      _launchFailures = 0;
      return browser;
    } catch (err: any) {
      _launchFailures++;
      console.error(
        `[price-monitor] Chromium launch failed (${_launchFailures}/${MAX_LAUNCH_FAILURES}): ${err?.message || err}`,
      );
      if (_launchFailures >= MAX_LAUNCH_FAILURES) {
        // Brief cooldown before allowing more attempts so we don't thrash.
        setTimeout(() => { _launchFailures = 0; }, 30_000);
      }
      throw err;
    } finally {
      _launching = null;
    }
  })();

  return _launching;
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    try { await _browser.close(); } catch {}
    _browser = null;
  }
}

// ─── PUBLIC API ─────────────────────────────────────

export async function scrapePrice(
  url: string,
  opts: { timeoutMs?: number; singleAttempt?: boolean; uaIndex?: number } = {},
): Promise<ScrapeResult> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const source = detectSource(url);

  let lastError: string | undefined;
  let lastStatus: number | undefined;
  let attempts = 0;
  // When the caller (self-healing wrapper) drives retries, do a single pass
  // and let the outer circuit-breaker decide when to retry. This avoids
  // double-retrying and keeps memory usage flat.
  const passes = opts.singleAttempt ? 1 : 2;
  const startUA = opts.uaIndex ?? 0;
  let lastUA = MOBILE_USER_AGENTS[startUA % MOBILE_USER_AGENTS.length]!;

  for (let i = 0; i < passes; i++) {
    attempts++;
    const slot = (startUA + i) % MOBILE_USER_AGENTS.length;
    const ua = MOBILE_USER_AGENTS[slot]!;
    const viewport = MOBILE_VIEWPORTS[slot % MOBILE_VIEWPORTS.length]!;
    lastUA = ua;

    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      const browser = await getBrowser();
      context = await browser.newContext({
        userAgent: ua,
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor,
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Ch-Ua-Mobile': '?1',
        },
      });

      // Block CSS, images, fonts, media for speed and resource savings.
      await context.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (type === 'image' || type === 'stylesheet' || type === 'font' || type === 'media') {
          return route.abort();
        }
        return route.continue();
      });

      page = await context.newPage();

      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });

      lastStatus = response?.status();

      if (lastStatus && lastStatus >= 400) {
        // Graceful 404 / blocked handling — return a snapshot indicating not in stock.
        if (lastStatus === 404) {
          return {
            snapshot: {
              product_name: '',
              current_price: null,
              currency: 'USD',
              in_stock: false,
              timestamp: new Date().toISOString(),
            },
            source,
            url,
            attempts,
            used_user_agent: ua,
            http_status: lastStatus,
            error: 'Page not found (404)',
          };
        }
        lastError = `HTTP ${lastStatus}`;
        continue; // retry with another UA
      }

      const html = await page.content();

      let snapshot: PriceSnapshot | null = null;
      if (source === 'amazon') {
        snapshot = await extractAmazon(page, html);
      } else if (source === 'ebay') {
        snapshot = await extractEbay(page, html);
      } else {
        snapshot = extractGeneric(html);
      }

      if (snapshot && (snapshot.product_name || snapshot.current_price !== null)) {
        return {
          snapshot,
          source,
          url,
          attempts,
          used_user_agent: ua,
          http_status: lastStatus,
        };
      }

      lastError = 'Could not extract product data (likely a CAPTCHA / bot wall)';
      // fall through to retry with different UA
    } catch (err: any) {
      lastError = err?.message || String(err);
    } finally {
      try { await page?.close(); } catch {}
      try { await context?.close(); } catch {}
    }
  }

  return {
    snapshot: null,
    source,
    url,
    attempts,
    used_user_agent: lastUA,
    http_status: lastStatus,
    error: lastError ?? 'Unknown scrape error',
  };
}

// ─── SITE DETECTION ─────────────────────────────────

function detectSource(url: string): 'amazon' | 'ebay' | 'generic' {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return 'generic'; }
  if (host.includes('amazon.')) return 'amazon';
  if (host.includes('ebay.')) return 'ebay';
  return 'generic';
}

// ─── AMAZON ─────────────────────────────────────────

async function extractAmazon(page: Page, html: string): Promise<PriceSnapshot> {
  const result = await page.evaluate(() => {
    const text = (sel: string) => document.querySelector(sel)?.textContent?.trim() || '';

    const title =
      text('#productTitle') ||
      text('#title') ||
      text('h1.product-title-word-break') ||
      text('h1');

    // Price candidates (mobile + desktop variants).
    const priceSelectors = [
      'span.a-price[data-a-color="price"] span.a-offscreen',
      'span.a-price span.a-offscreen',
      '#corePrice_feature_div span.a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#priceblock_saleprice',
      'span#price_inside_buybox',
      'span.priceToPay span.a-offscreen',
      'span[data-a-size="xl"] span.a-offscreen',
    ];
    let priceRaw = '';
    for (const sel of priceSelectors) {
      const v = text(sel);
      if (v) { priceRaw = v; break; }
    }

    // Stock / availability text.
    const availability =
      text('#availability') ||
      text('#availability_feature_div') ||
      text('#outOfStock') ||
      text('div#availability span') ||
      '';

    return { title, priceRaw, availability };
  });

  const { price, currency } = parsePrice(result.priceRaw);
  const availLower = result.availability.toLowerCase();
  const outOfStock =
    /out of stock|currently unavailable|temporarily out of stock|sold out|unavailable/.test(availLower) ||
    (price === null && /unavailable/.test(availLower));

  // Fallback: scrape JSON-LD if title or price missing.
  let title = result.title;
  let finalPrice = price;
  let finalCurrency = currency || 'USD';
  if (!title || finalPrice === null) {
    const ld = parseJsonLd(html);
    if (ld) {
      if (!title) title = ld.name || '';
      if (finalPrice === null && ld.price !== null) finalPrice = ld.price;
      if (ld.currency) finalCurrency = ld.currency;
    }
  }

  return {
    product_name: title || 'Unknown product',
    current_price: finalPrice,
    currency: finalCurrency,
    in_stock: !outOfStock && finalPrice !== null,
    timestamp: new Date().toISOString(),
  };
}

// ─── EBAY ───────────────────────────────────────────

async function extractEbay(page: Page, html: string): Promise<PriceSnapshot> {
  const result = await page.evaluate(() => {
    const text = (sel: string) => document.querySelector(sel)?.textContent?.trim() || '';

    const title =
      text('h1.x-item-title__mainTitle span.ux-textspans') ||
      text('h1.x-item-title__mainTitle') ||
      text('h1#itemTitle') ||
      text('h1');

    const priceRaw =
      text('div.x-price-primary span.ux-textspans') ||
      text('span.x-price-primary') ||
      text('span#prcIsum') ||
      text('span#mm-saleDscPrc') ||
      text('span[itemprop="price"]') ||
      text('div.vim.x-price-primary') ||
      '';

    const availability =
      text('span.d-quantity__availability') ||
      text('div#qtySubTxt') ||
      text('span#qtySubTxt') ||
      text('div.x-quantity__availability') ||
      text('div.d-quantity') ||
      '';

    const ended = !!document.querySelector('div.vi-is1-titleH1, div.statusContent, span.statusLeftCntStat');

    return { title, priceRaw, availability, ended };
  });

  const { price, currency } = parsePrice(result.priceRaw);

  const availLower = result.availability.toLowerCase();
  const outOfStock =
    result.ended ||
    /out of stock|sold|no longer available|unavailable/.test(availLower) ||
    /this listing has ended/.test(availLower);

  let title = result.title;
  let finalPrice = price;
  let finalCurrency = currency || 'USD';
  if (!title || finalPrice === null) {
    const ld = parseJsonLd(html);
    if (ld) {
      if (!title) title = ld.name || '';
      if (finalPrice === null && ld.price !== null) finalPrice = ld.price;
      if (ld.currency) finalCurrency = ld.currency;
    }
  }

  return {
    product_name: title || 'Unknown product',
    current_price: finalPrice,
    currency: finalCurrency,
    in_stock: !outOfStock && finalPrice !== null,
    timestamp: new Date().toISOString(),
  };
}

// ─── GENERIC FALLBACK ───────────────────────────────

function extractGeneric(html: string): PriceSnapshot {
  const ld = parseJsonLd(html);
  const og = parseOpenGraph(html);

  const name = ld?.name || og.title || '';
  const price = ld?.price ?? og.price ?? null;
  const currency = ld?.currency || og.currency || 'USD';
  const availability = (ld?.availability || og.availability || '').toLowerCase();
  const inStock = price !== null && !/out.?of.?stock|sold.?out|unavailable|discontinued/.test(availability);

  return {
    product_name: name || 'Unknown product',
    current_price: price,
    currency,
    in_stock: inStock,
    timestamp: new Date().toISOString(),
  };
}

// ─── PARSERS ────────────────────────────────────────

const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  '$': 'USD', 'US$': 'USD', 'CA$': 'CAD', 'C$': 'CAD', 'A$': 'AUD',
  '£': 'GBP', '€': 'EUR', '¥': 'JPY', '₹': 'INR', 'R$': 'BRL', '₩': 'KRW',
};

function parsePrice(raw: string): { price: number | null; currency: string } {
  if (!raw) return { price: null, currency: '' };
  const trimmed = raw.replace(/\s+/g, ' ').trim();

  // ISO currency code (USD, EUR, etc.) anywhere in string.
  let currency = '';
  const iso = trimmed.match(/\b([A-Z]{3})\b/);
  if (iso && ['USD','EUR','GBP','JPY','CAD','AUD','INR','BRL','MXN','CNY','KRW'].includes(iso[1]!)) {
    currency = iso[1]!;
  } else {
    for (const sym of Object.keys(CURRENCY_SYMBOL_MAP)) {
      if (trimmed.includes(sym)) { currency = CURRENCY_SYMBOL_MAP[sym]!; break; }
    }
  }

  // Extract the numeric portion. Handles "1,299.99" and "1.299,99".
  const numMatch = trimmed.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!numMatch) return { price: null, currency };
  let numStr = numMatch[1]!;

  // Decide decimal separator.
  const lastComma = numStr.lastIndexOf(',');
  const lastDot = numStr.lastIndexOf('.');
  if (lastComma > lastDot) {
    // European: 1.299,99
    numStr = numStr.replace(/\./g, '').replace(',', '.');
  } else {
    // US/UK: 1,299.99
    numStr = numStr.replace(/,/g, '');
  }

  const price = Number(numStr);
  return { price: Number.isFinite(price) ? price : null, currency };
}

interface LdData { name: string; price: number | null; currency: string; availability: string; }

function parseJsonLd(html: string): LdData | null {
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (!blocks) return null;

  for (const block of blocks) {
    const inner = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
    let data: any;
    try { data = JSON.parse(inner); } catch { continue; }

    const candidates: any[] = Array.isArray(data) ? data : (data['@graph'] ? data['@graph'] : [data]);
    for (const item of candidates) {
      const type = item?.['@type'];
      const isProduct =
        type === 'Product' ||
        (Array.isArray(type) && type.includes('Product'));
      if (!isProduct) continue;

      const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
      const price = offers?.price ?? offers?.lowPrice ?? null;
      const currency = offers?.priceCurrency || '';
      const availability = String(offers?.availability || '').toLowerCase();
      return {
        name: String(item.name || ''),
        price: price !== null && price !== undefined ? Number(price) : null,
        currency,
        availability,
      };
    }
  }
  return null;
}

function parseOpenGraph(html: string): { title: string; price: number | null; currency: string; availability: string } {
  const meta = (prop: string): string => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
    const m = html.match(re);
    return m?.[1] ?? '';
  };
  const altMeta = (prop: string): string => {
    const re = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
    const m = html.match(re);
    return m?.[1] ?? '';
  };
  const get = (prop: string) => meta(prop) || altMeta(prop);

  const title = get('og:title') || get('twitter:title');
  const priceStr = get('product:price:amount') || get('og:price:amount');
  const currency = get('product:price:currency') || get('og:price:currency') || '';
  const availability = get('product:availability') || get('og:availability') || '';
  const price = priceStr ? Number(priceStr) : null;

  return { title, price: Number.isFinite(price as number) ? price : null, currency, availability };
}
