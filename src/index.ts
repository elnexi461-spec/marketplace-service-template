/**
 * EL-BADOO Premium 4G Scraping Hub — Server Entry
 * ────────────────────────────────────────────────
 * Hono + Bun, gated by Coinbase x402 (Managed Facilitator) at $0.05 USDC/Base.
 *
 * Pipeline:
 *   1. Security headers + CORS + rate limit  (this file)
 *   2. x402 paywall on POST /api/scrape       (src/x402-config.ts)
 *   3. Self-healing scrape pipeline           (src/self-healing.ts)
 *   4. Discovery extension for the Bazaar     (src/discovery.ts)
 *
 * All other endpoints (Maps / SERP / Reviews / LinkedIn / Reddit / IG / Airbnb / …)
 * remain mounted from src/service.ts unchanged.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { serviceRouter } from './service';
import { buildPaywall, getReceiver, X402_PRICE_USD, X402_NETWORK } from './x402-config';
import { declareDiscoveryExtension } from './discovery';

const app = new Hono();

// ─── MIDDLEWARE ──────────────────────────────────────

app.use('*', logger());

app.use('*', cors({
  origin: '*',
  allowHeaders: [
    'Content-Type',
    'Payment-Signature',
    'X-Payment-Signature',
    'X-Payment-Network',
    'X-PAYMENT',
  ],
  exposeHeaders: [
    'X-Payment-Settled',
    'X-Payment-TxHash',
    'X-PAYMENT-RESPONSE',
    'Retry-After',
  ],
}));

// Security headers
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
});

// In-memory rate limit (per IP, per minute).
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || '60');

app.use('*', async (c, next) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
  } else {
    entry.count++;
    if (entry.count > RATE_LIMIT) {
      c.header('Retry-After', '60');
      return c.json({ error: 'Rate limit exceeded', retryAfter: 60 }, 429);
    }
  }
  await next();
});

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(ip);
  }
}, 300_000);

// ─── x402 PAYWALL (Coinbase Managed Facilitator) ────
// Mount BEFORE serviceRouter so it intercepts /api/scrape.
let paywallReady = false;
try {
  app.use(buildPaywall());
  paywallReady = true;
  console.log(
    `[x402] paywall active — ${X402_PRICE_USD} USDC on ${X402_NETWORK} → ${getReceiver()}`,
  );
} catch (err: any) {
  console.error(
    `[x402] paywall NOT mounted: ${err.message}\n` +
    '       Set USDC_RECEIVER_ADDRESS, CDP_API_KEY_NAME, CDP_API_KEY_PRIVATE_KEY in Replit Secrets.',
  );
}

// ─── ROUTES ─────────────────────────────────────────

app.get('/health', (c) => c.json({
  status: 'healthy',
  service: 'EL-BADOO Premium 4G Scraping Hub',
  version: '3.0.0',
  paywall: paywallReady ? 'active' : 'misconfigured',
  facilitator: 'coinbase-managed',
  timestamp: new Date().toISOString(),
}));

/**
 * x402 Discovery — published at /.well-known/x402 so the Coinbase Bazaar
 * and other agent indexers can find and list this service.
 */
app.get('/.well-known/x402', (c) => {
  try {
    return c.json({
      x402Version: 2,
      discovery: declareDiscoveryExtension({
        baseUrl: `${c.req.header('x-forwarded-proto') || 'https'}://${c.req.header('host')}`,
      }),
    });
  } catch (err: any) {
    return c.json({ error: 'Discovery unavailable', reason: err.message }, 503);
  }
});

app.get('/', (c) => {
  let discovery: ReturnType<typeof declareDiscoveryExtension> | null = null;
  try {
    discovery = declareDiscoveryExtension({
      baseUrl: `${c.req.header('x-forwarded-proto') || 'https'}://${c.req.header('host')}`,
    });
  } catch { /* discovery unavailable until receiver is set */ }

  return c.json({
    name: 'EL-BADOO Premium 4G Scraping Hub',
    description:
      'High-trust, mobile-first lead enrichment via authentic Nigerian 4G cluster. 30s IP rotation enabled.',
    version: '3.0.0',
    paywall: {
      active: paywallReady,
      price: X402_PRICE_USD,
      currency: 'USDC',
      network: X402_NETWORK,
      facilitator: 'coinbase-managed',
      gatedRoutes: ['POST /api/scrape'],
    },
    selfHealing: {
      enabled: true,
      maxAttempts: 3,
      strategies: {
        '403': '30s wait for 4G mobile IP rotation, then retry',
        timeout: 'linear backoff retry',
        domMismatch: 'fallback selector + HTML structure log, retry',
      },
    },
    discovery,
    links: {
      health: '/health',
      x402Discovery: '/.well-known/x402',
      api: '/api/*',
    },
  });
});

app.route('/api', serviceRouter);

app.notFound((c) => c.json({
  error: 'Not found',
  hint: 'See / for the service catalog and /.well-known/x402 for discovery metadata.',
}, 404));

app.onError((err, c) => {
  console.error(`[ERROR] ${err.message}`);
  return c.json({ error: 'Internal server error' }, 500);
});

// ─── DISCOVERY EXPORT (for Bazaar indexers / static tooling) ───
export { declareDiscoveryExtension } from './discovery';

export default {
  port: parseInt(process.env.PORT || '3000'),
  hostname: '0.0.0.0',
  fetch: app.fetch,
};
