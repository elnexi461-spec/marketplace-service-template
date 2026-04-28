/**
 * Service Router — Marketplace API
 *
 * Exposes:
 *   GET /api/run       (Google Maps Lead Generator)
 *   GET /api/details   (Google Maps Place details)
 *   GET /api/jobs      (Job Market Intelligence)
 *   GET /api/reviews/* (Google Reviews & Business Data)
 *   GET /api/airbnb/*  (Airbnb Market Intelligence)
 *   GET /api/reddit/*  (Reddit Intelligence)
 *   GET /api/instagram/* (Instagram Intelligence + AI Vision)
 *   GET /api/linkedin/* (LinkedIn Enrichment)
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { getProfile, getPosts, analyzeProfile, analyzeImages, auditProfile } from './scrapers/instagram-scraper';

export const serviceRouter = new Hono();

// ─── PRICE MONITOR (Bounty Wave 2 — E-Commerce Price & Stock) ───
const SCRAPE_PRICE_USDC = parseFloat(process.env.SCRAPE_PRICE_USDC || '0.002');
const SCRAPE_DESCRIPTION = 'E-Commerce Price & Stock Monitor — fetches product name, price, currency, and stock status from Amazon, eBay, and other product pages.';
const SCRAPE_TIMEOUT_MS = parseInt(process.env.SCRAPE_TIMEOUT_MS || '5000');
const SCRAPE_OUTPUT_SCHEMA = {
  input: { url: 'string — full product page URL (Amazon, eBay, or generic product page)' },
  output: {
    product_name: 'string',
    current_price: 'number | null',
    currency: 'string (ISO 4217 code)',
    in_stock: 'boolean',
    timestamp: 'string (ISO 8601)',
  },
};

function build402BaseOnly(
  resource: string,
  description: string,
  priceUSDC: number,
  outputSchema: Record<string, any> = SCRAPE_OUTPUT_SCHEMA,
) {
  const baseRecipient = process.env.WALLET_ADDRESS_BASE || process.env.WALLET_ADDRESS || '';
  // x402 "exact" scheme uses USDC base units (6 decimals) on Base.
  const maxAmountRequired = String(Math.round(priceUSDC * 1_000_000));
  return {
    x402Version: 2,
    error: 'X-PAYMENT header is required',
    accepts: [
      {
        scheme: 'exact',
        network: 'base',
        chainId: 'eip155:8453',
        maxAmountRequired,
        resource,
        description,
        mimeType: 'application/json',
        payTo: baseRecipient,
        maxTimeoutSeconds: 60,
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        extra: { name: 'USD Coin', version: '2' },
      },
    ],
    price: { amount: String(priceUSDC), currency: 'USDC' },
    headers: {
      required: ['Payment-Signature'],
      optional: ['X-Payment-Network'],
      format: 'Payment-Signature: <base_tx_hash>',
    },
    outputSchema,
  };
}


// Convenience: GET /scrape returns the 402 challenge (useful for clients to discover pricing).

// ─── TREND INTELLIGENCE ROUTES (Bounty #70) ─────────

const SERVICE_NAME = 'job-market-intelligence';
const PRICE_USDC = 0.005;
const DESCRIPTION = 'Job Market Intelligence API (Indeed/LinkedIn): title, company, location, salary, date, link, remote + proxy exit metadata.';
const MAPS_PRICE_USDC = 0.005;
const MAPS_DESCRIPTION = 'Extract structured business data from Google Maps: name, address, phone, website, email, hours, ratings, reviews, categories, and geocoordinates. Search by category + location with full pagination.';

const MAPS_OUTPUT_SCHEMA = {
  input: {
    query: 'string — Search query/category (required)',
    location: 'string — Location to search (required)',
    limit: 'number — Max results to return (default: 20, max: 100)',
    pageToken: 'string — Pagination token for next page (optional)',
  },
  output: {
    businesses: [{
      name: 'string',
      address: 'string | null',
      phone: 'string | null',
      website: 'string | null',
      email: 'string | null',
      hours: 'object | null',
      rating: 'number | null',
      reviewCount: 'number | null',
      categories: 'string[]',
      coordinates: '{ latitude, longitude } | null',
      placeId: 'string | null',
      priceLevel: 'string | null',
      permanentlyClosed: 'boolean',
    }],
    totalFound: 'number',
    nextPageToken: 'string | null',
    searchQuery: 'string',
    location: 'string',
    proxy: '{ country: string, type: "mobile" }',
    payment: '{ txHash, network, amount, settled }',
  },
};

async function getProxyExitIp(): Promise<string | null> {
  try {
    const r = await proxyFetch('https://api.ipify.org?format=json', {
      headers: { 'Accept': 'application/json' },
      maxRetries: 1,
      timeoutMs: 15_000,
    });
    if (!r.ok) return null;
    const data: any = await r.json();
    return typeof data?.ip === 'string' ? data.ip : null;
  } catch {
    return null;
  }
}


// ═══════════════════════════════════════════════════════
// ─── GOOGLE REVIEWS & BUSINESS DATA API ─────────────
// ═══════════════════════════════════════════════════════

const REVIEWS_PRICE_USDC = 0.02;   // $0.02 per reviews fetch
const BUSINESS_PRICE_USDC = 0.01;  // $0.01 per business lookup
const SUMMARY_PRICE_USDC = 0.005;  // $0.005 per summary

// ─── PROXY RATE LIMITING (prevent proxy quota abuse) ──
const proxyUsage = new Map<string, { count: number; resetAt: number }>();
const PROXY_RATE_LIMIT = 20; // max proxy-routed requests per minute per IP

function checkProxyRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = proxyUsage.get(ip);
  if (!entry || now > entry.resetAt) {
    proxyUsage.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= PROXY_RATE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of proxyUsage) {
    if (now > entry.resetAt) proxyUsage.delete(ip);
  }
}, 300_000);

// ─── GET /api/reviews/search ────────────────────────


// ─── GET /api/reviews/summary/:place_id ─────────────


// ─── GET /api/reviews/:place_id ─────────────────────


// ─── GET /api/business/:place_id ────────────────────


// ═══════════════════════════════════════════════════════
// ─── LINKEDIN PEOPLE & COMPANY ENRICHMENT API (Bounty #77) ─────────
// ═══════════════════════════════════════════════════════

const LINKEDIN_PERSON_PRICE_USDC = 0.03;    // $0.03 per person profile
const LINKEDIN_COMPANY_PRICE_USDC = 0.05;   // $0.05 per company profile
const LINKEDIN_SEARCH_PRICE_USDC = 0.10;    // $0.10 per search query

// ─── GET /api/linkedin/person ────────────────────────

// ─── GET /api/linkedin/company ────────────────────────

// ─── GET /api/linkedin/search/people ────────────────────────

// ─── GET /api/linkedin/company/:id/employees ────────────────────────

// ═══════════════════════════════════════════════════════
// ─── REDDIT INTELLIGENCE API (Bounty #68) ──────────
// ═══════════════════════════════════════════════════════

const REDDIT_SEARCH_PRICE = 0.005;   // $0.005 per search/subreddit
const REDDIT_COMMENTS_PRICE = 0.01;  // $0.01 per comment thread

// ─── GET /api/reddit/search ─────────────────────────


// ─── GET /api/reddit/trending ───────────────────────


// ─── GET /api/reddit/subreddit/:name ────────────────


// ─── GET /api/reddit/thread/:id ─────────────────────


// ═══════════════════════════════════════════════════════
// ─── INSTAGRAM INTELLIGENCE + AI VISION API ─────────
// ═══════════════════════════════════════════════════════

const IG_PROFILE_PRICE  = 0.01;   // $0.01 per profile lookup
const IG_POSTS_PRICE    = 0.02;   // $0.02 per posts fetch
const IG_ANALYZE_PRICE  = 0.15;   // $0.15 per full analysis (includes AI vision)
const IG_IMAGES_PRICE   = 0.08;   // $0.08 per image-only analysis
const IG_AUDIT_PRICE    = 0.05;   // $0.05 per authenticity audit

// ─── GET /api/instagram/profile/:username ───────────

serviceRouter.get('/instagram/profile/:username', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/instagram/profile/:username', 'Get Instagram profile data: followers, bio, engagement rate, posting frequency', IG_PROFILE_PRICE, walletAddress, {
      input: { username: 'string (required) — Instagram username (in URL path)' },
      output: {
        profile: 'InstagramProfile — username, full_name, bio, followers, following, posts_count, is_verified, is_business, engagement_rate, avg_likes, avg_comments, posting_frequency',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, IG_PROFILE_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  const username = c.req.param('username');
  if (!username) return c.json({ error: 'Missing username in URL path' }, 400);

  try {
    const proxy = getProxy();
    const profile = await getProfile(username);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      profile,
      meta: { proxy: { country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Instagram profile fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/instagram/posts/:username ─────────────

serviceRouter.get('/instagram/posts/:username', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/instagram/posts/:username', 'Get recent Instagram posts: captions, likes, comments, hashtags, timestamps', IG_POSTS_PRICE, walletAddress, {
      input: {
        username: 'string (required) — Instagram username (in URL path)',
        limit: 'number (optional, default: 12, max: 50)',
      },
      output: {
        posts: 'InstagramPost[] — id, shortcode, type, caption, likes, comments, timestamp, image_url, video_url, is_sponsored, hashtags',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, IG_POSTS_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  const username = c.req.param('username');
  if (!username) return c.json({ error: 'Missing username in URL path' }, 400);

  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '12') || 12, 1), 50);

  try {
    const proxy = getProxy();
    const posts = await getPosts(username, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      posts,
      meta: { username, count: posts.length, proxy: { country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Instagram posts fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/instagram/analyze/:username ───────────

serviceRouter.get('/instagram/analyze/:username', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/instagram/analyze/:username', 'Full Instagram analysis: profile + posts + AI vision analysis (account type, content themes, sentiment, authenticity, brand recommendations)', IG_ANALYZE_PRICE, walletAddress, {
      input: { username: 'string (required) — Instagram username (in URL path)' },
      output: {
        profile: 'InstagramProfile',
        posts: 'InstagramPost[]',
        ai_analysis: '{ account_type, content_themes, sentiment, authenticity, images_analyzed, model_used, recommendations }',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, IG_ANALYZE_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  const username = c.req.param('username');
  if (!username) return c.json({ error: 'Missing username in URL path' }, 400);

  try {
    const proxy = getProxy();
    const result = await analyzeProfile(username);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: { proxy: { country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Instagram analysis failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/instagram/analyze/:username/images ────

serviceRouter.get('/instagram/analyze/:username/images', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/instagram/analyze/:username/images', 'AI vision analysis of Instagram images only: content themes, style, aesthetic consistency, brand safety', IG_IMAGES_PRICE, walletAddress, {
      input: { username: 'string (required) — Instagram username (in URL path)' },
      output: {
        images_analyzed: 'number',
        analysis: '{ account_type, content_themes, sentiment, authenticity, recommendations, model_used }',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, IG_IMAGES_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  const username = c.req.param('username');
  if (!username) return c.json({ error: 'Missing username in URL path' }, 400);

  try {
    const proxy = getProxy();
    const result = await analyzeImages(username);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: { username, proxy: { country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Instagram image analysis failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/instagram/audit/:username ─────────────

serviceRouter.get('/instagram/audit/:username', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/instagram/audit/:username', 'Instagram authenticity audit: fake follower detection, engagement pattern analysis, bot signals', IG_AUDIT_PRICE, walletAddress, {
      input: { username: 'string (required) — Instagram username (in URL path)' },
      output: {
        profile: 'InstagramProfile',
        authenticity: '{ score, verdict, face_consistency, engagement_pattern, follower_quality, comment_analysis, fake_signals }',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, IG_AUDIT_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  const username = c.req.param('username');
  if (!username) return c.json({ error: 'Missing username in URL path' }, 400);

  try {
    const proxy = getProxy();
    const result = await auditProfile(username);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: { proxy: { country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Instagram audit failed', message: err?.message || String(err) }, 502);
  }
});

// ═══════════════════════════════════════════════════════
// ─── AIRBNB MARKET INTELLIGENCE API (Bounty #78) ────
// ═══════════════════════════════════════════════════════

const AIRBNB_SEARCH_PRICE = 0.02;
const AIRBNB_LISTING_PRICE = 0.01;
const AIRBNB_REVIEWS_PRICE = 0.01;
const AIRBNB_MARKET_STATS_PRICE = 0.05;

// ─── GET /api/airbnb/search ─────────────────────────


// ─── GET /api/airbnb/listing/:id ────────────────────


// ─── GET /api/airbnb/reviews/:listing_id ────────────


// ─── GET /api/airbnb/market-stats ───────────────────


// ─── MOBILE SERP (Playwright + iPhone 14, x402-gated on Base) ───

