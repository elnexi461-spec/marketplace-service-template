/**
 * E-Commerce Price & Stock Monitor — ScraperAPI Edition
 * ─────────────────────────────────────────────────────
 * Fully cloud-native: HTML is fetched via ScraperAPI (JS rendered,
 * IP-rotated) and parsed with pure-string extractors. Zero local
 * browser, zero Chromium RAM cost.
 *
 * Returns a normalized PriceSnapshot for Amazon, eBay, and a
 * generic JSON-LD / OpenGraph fallback for other sites.
 */

import { fetchHTML, needsPremium, ScraperApiError } from './scraperapi';

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
  used_user_agent: string;        // kept for response-shape compatibility
  error?: string;
  http_status?: number;
}

// Cosmetic value kept so existing JSON response shape doesn't change.
const PROXY_UA_LABEL = 'scraperapi/cloud (mobile pool)';

// ─── PUBLIC API ─────────────────────────────────────

export async function scrapePrice(
  url: string,
  opts: { timeoutMs?: number; singleAttempt?: boolean; uaIndex?: number } = {},
): Promise<ScrapeResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const source = detectSource(url);

  try {
    const html = await fetchHTML(url, {
      render: true,
      premium: needsPremium(url),
      timeoutMs,
    });

    let snapshot: PriceSnapshot | null = null;
    if (source === 'amazon')      snapshot = extractAmazon(html);
    else if (source === 'ebay')   snapshot = extractEbay(html);
    else                          snapshot = extractGeneric(html);

    if (snapshot && (snapshot.product_name || snapshot.current_price !== null)) {
      return {
        snapshot,
        source,
        url,
        attempts: 1,
        used_user_agent: PROXY_UA_LABEL,
        http_status: 200,
      };
    }

    return {
      snapshot: null,
      source,
      url,
      attempts: 1,
      used_user_agent: PROXY_UA_LABEL,
      http_status: 200,
      error: 'Could not extract product data (likely a CAPTCHA / bot wall)',
    };
  } catch (err: any) {
    const status = err instanceof ScraperApiError ? err.status : undefined;
    return {
      snapshot: null,
      source,
      url,
      attempts: 1,
      used_user_agent: PROXY_UA_LABEL,
      http_status: status,
      error: err?.message || String(err),
    };
  }
}

// ─── SITE DETECTION ─────────────────────────────────

function detectSource(url: string): 'amazon' | 'ebay' | 'generic' {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return 'generic'; }
  if (host.includes('amazon.')) return 'amazon';
  if (host.includes('ebay.'))   return 'ebay';
  return 'generic';
}

// ─── AMAZON ─────────────────────────────────────────

function extractAmazon(html: string): PriceSnapshot {
  // Primary: JSON-LD Product (Amazon ships this on most product pages).
  const ld = parseJsonLd(html);

  // Fallback regexes for raw HTML (when JSON-LD is missing/partial).
  const title =
    ld?.name ||
    extractTagText(html, /<span[^>]+id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i) ||
    extractTagText(html, /<h1[^>]*id=["']title["'][^>]*>([\s\S]*?)<\/h1>/i) ||
    extractTagText(html, /<h1[^>]*class=["'][^"']*product-title-word-break[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i) ||
    extractTagText(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);

  let priceRaw = '';
  const priceRegexes = [
    /<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([^<]+)<\/span>/i,
    /<span[^>]+id=["']priceblock_(?:our|deal|sale)price["'][^>]*>([^<]+)<\/span>/i,
    /<span[^>]+id=["']price_inside_buybox["'][^>]*>([^<]+)<\/span>/i,
  ];
  for (const re of priceRegexes) {
    const m = html.match(re);
    if (m && m[1]) { priceRaw = m[1]; break; }
  }

  const availability =
    extractTagText(html, /<div[^>]+id=["']availability["'][^>]*>([\s\S]*?)<\/div>/i) ||
    extractTagText(html, /<span[^>]+id=["']availability["'][^>]*>([\s\S]*?)<\/span>/i) ||
    '';

  const { price: regexPrice, currency: regexCurrency } = parsePrice(priceRaw);
  const finalPrice = ld?.price ?? regexPrice;
  const finalCurrency = ld?.currency || regexCurrency || 'USD';
  const availLower = (ld?.availability || availability).toLowerCase();
  const outOfStock =
    /out of stock|currently unavailable|temporarily out of stock|sold out|unavailable|outofstock/.test(availLower) ||
    (finalPrice === null && /unavailable/.test(availLower));

  return {
    product_name: title || 'Unknown product',
    current_price: finalPrice,
    currency: finalCurrency,
    in_stock: !outOfStock && finalPrice !== null,
    timestamp: new Date().toISOString(),
  };
}

// ─── EBAY ───────────────────────────────────────────

function extractEbay(html: string): PriceSnapshot {
  const ld = parseJsonLd(html);

  const title =
    ld?.name ||
    extractTagText(html, /<h1[^>]*class=["'][^"']*x-item-title__mainTitle[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i) ||
    extractTagText(html, /<h1[^>]*id=["']itemTitle["'][^>]*>([\s\S]*?)<\/h1>/i) ||
    extractTagText(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);

  let priceRaw = '';
  const priceRegexes = [
    /<div[^>]+class=["'][^"']*x-price-primary[^"']*["'][^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i,
    /<span[^>]+id=["']prcIsum["'][^>]*>([^<]+)<\/span>/i,
    /<span[^>]+id=["']mm-saleDscPrc["'][^>]*>([^<]+)<\/span>/i,
    /<span[^>]+itemprop=["']price["'][^>]*>([^<]+)<\/span>/i,
  ];
  for (const re of priceRegexes) {
    const m = html.match(re);
    if (m && m[1]) { priceRaw = m[1]; break; }
  }

  const availability =
    extractTagText(html, /<span[^>]+id=["']qtySubTxt["'][^>]*>([\s\S]*?)<\/span>/i) ||
    extractTagText(html, /<div[^>]+class=["'][^"']*x-quantity__availability[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
    '';

  const ended = /this listing has ended|listing ended/i.test(html);

  const { price: regexPrice, currency: regexCurrency } = parsePrice(priceRaw);
  const finalPrice = ld?.price ?? regexPrice;
  const finalCurrency = ld?.currency || regexCurrency || 'USD';
  const availLower = (ld?.availability || availability).toLowerCase();
  const outOfStock =
    ended ||
    /out of stock|sold|no longer available|unavailable|outofstock/.test(availLower);

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
  const inStock = price !== null && !/out.?of.?stock|sold.?out|unavailable|discontinued|outofstock/.test(availability);

  return {
    product_name: name || 'Unknown product',
    current_price: price,
    currency,
    in_stock: inStock,
    timestamp: new Date().toISOString(),
  };
}

// ─── HTML / TEXT HELPERS ────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function extractTagText(html: string, re: RegExp): string {
  const m = html.match(re);
  return m && m[1] ? decodeEntities(stripTags(m[1])) : '';
}

// ─── PARSERS ────────────────────────────────────────

const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  '$': 'USD', 'US$': 'USD', 'CA$': 'CAD', 'C$': 'CAD', 'A$': 'AUD',
  '£': 'GBP', '€': 'EUR', '¥': 'JPY', '₹': 'INR', 'R$': 'BRL', '₩': 'KRW',
};

function parsePrice(raw: string): { price: number | null; currency: string } {
  if (!raw) return { price: null, currency: '' };
  const trimmed = decodeEntities(raw).replace(/\s+/g, ' ').trim();

  let currency = '';
  const iso = trimmed.match(/\b([A-Z]{3})\b/);
  if (iso && ['USD','EUR','GBP','JPY','CAD','AUD','INR','BRL','MXN','CNY','KRW'].includes(iso[1]!)) {
    currency = iso[1]!;
  } else {
    for (const sym of Object.keys(CURRENCY_SYMBOL_MAP)) {
      if (trimmed.includes(sym)) { currency = CURRENCY_SYMBOL_MAP[sym]!; break; }
    }
  }

  const numMatch = trimmed.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!numMatch) return { price: null, currency };
  let numStr = numMatch[1]!;

  const lastComma = numStr.lastIndexOf(',');
  const lastDot = numStr.lastIndexOf('.');
  if (lastComma > lastDot) {
    numStr = numStr.replace(/\./g, '').replace(',', '.');
  } else {
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
