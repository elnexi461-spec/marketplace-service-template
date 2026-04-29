/**
 * Discovery Extension — Coinbase Bazaar Indexing
 * ───────────────────────────────────────────────
 * Self-describing metadata so the service shows up in the x402
 * Bazaar / agent marketplaces. The shape below matches the x402
 * `DiscoveredResource` schema, plus a few EL-BADOO-specific
 * extension fields under `extra`.
 *
 * Exposed:
 *   • Importable `discoveryExtension` constant (consumed by indexers)
 *   • `declareDiscoveryExtension()` factory (matches the agreed API)
 *   • `GET /.well-known/x402` route helper (registered in index.ts)
 */

import { X402_PRICE_USD, X402_NETWORK, getReceiver } from './x402-config';

const USDC_BASE_ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

export interface DiscoveryExtension {
  x402Version: number;
  name: string;
  description: string;
  resource: string;
  type: 'http';
  network: string;
  price: { amount: string; currency: 'USDC' };
  payTo: string;
  asset: string;
  capabilities: string[];
  tags: string[];
  extra: Record<string, unknown>;
}

export interface DeclareDiscoveryInput {
  /** Public base URL where the service is reachable. */
  baseUrl?: string;
  /** Override the resource path (defaults to `/api/scrape`). */
  resourcePath?: string;
  /** Extra metadata merged into `extra` (e.g. region, build). */
  extra?: Record<string, unknown>;
}

const DEFAULT_NAME = 'EL-BADOO Premium 4G Scraping Hub';
const DEFAULT_DESC =
  'High-trust, mobile-first lead enrichment via authentic Nigerian 4G cluster. 30s IP rotation enabled.';

/**
 * Build the discovery extension descriptor.
 * Safe to call at startup (will throw if USDC_RECEIVER_ADDRESS is unset).
 */
export function declareDiscoveryExtension(
  input: DeclareDiscoveryInput = {},
): DiscoveryExtension {
  const baseUrl =
    input.baseUrl ||
    process.env.PUBLIC_BASE_URL ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:5000');
  const resourcePath = input.resourcePath || '/api/scrape';

  return {
    x402Version: 2,
    name: DEFAULT_NAME,
    description: DEFAULT_DESC,
    resource: `${baseUrl.replace(/\/$/, '')}${resourcePath}`,
    type: 'http',
    network: X402_NETWORK,
    price: { amount: X402_PRICE_USD.replace('$', ''), currency: 'USDC' },
    payTo: getReceiver(),
    asset: USDC_BASE_ASSET,
    capabilities: [
      'price-monitor',
      'amazon',
      'ebay',
      'generic-product-page',
      'mobile-4g-proxy',
      'self-healing-circuit-breaker',
    ],
    tags: ['scraping', 'mobile-proxy', 'x402', 'usdc', 'base', 'nigeria-4g'],
    extra: {
      operator: 'EL-BADOO',
      proxyType: 'mobile-4g',
      proxyRegion: 'NG',
      ipRotationSeconds: 30,
      runtime: 'bun',
      browser: 'playwright-core/chromium --single-process',
      maxRetries: 3,
      ...input.extra,
    },
  };
}

/** Eagerly evaluated convenience — kept lazy via getter to avoid throwing on import. */
export const discoveryExtension = {
  get value(): DiscoveryExtension {
    return declareDiscoveryExtension();
  },
};
