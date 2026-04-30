/**
 * x402 Paywall Configuration — Coinbase Managed Facilitator
 * ──────────────────────────────────────────────────────────
 * Wires `x402-hono` paymentMiddleware to the Coinbase-hosted facilitator
 * (verify + settle on-chain via CDP) using the credentials in Replit Secrets:
 *
 *   - CDP_API_KEY_NAME            (Coinbase Developer Platform key id)
 *   - CDP_API_KEY_PRIVATE_KEY     (Coinbase Developer Platform key secret)
 *   - USDC_RECEIVER_ADDRESS       (Base EVM address that receives USDC)
 *
 * Network: Base mainnet (EVM)   Asset: USDC   Price: $0.05 per request.
 *
 * NOTE: The repo runs on Hono + Bun. The Coinbase x402 family ships
 * `x402-hono` as the Hono-native equivalent of `x402-express`; we use it
 * here so the middleware actually integrates with the running framework.
 */

import { paymentMiddleware, type RoutesConfig } from 'x402-hono';
import { facilitator as managedFacilitator, createFacilitatorConfig } from '@coinbase/x402';
import type { FacilitatorConfig } from 'x402/types';
import type { Address } from 'viem';

export const X402_PRICE_USD = '$0.05';
export const X402_NETWORK = 'base' as const;

/** Resolve the receiving wallet — strict, no demo fallbacks. */
export function getReceiver(): Address {
  const addr =
    process.env.USDC_RECEIVER_ADDRESS ||
    process.env.WALLET_ADDRESS_BASE ||
    process.env.WALLET_ADDRESS;
  if (!addr) {
    throw new Error(
      'USDC_RECEIVER_ADDRESS is not set. Add it (or WALLET_ADDRESS_BASE) to Replit Secrets.',
    );
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    throw new Error(`USDC_RECEIVER_ADDRESS is not a valid EVM address: ${addr}`);
  }
  return addr as Address;
}

/**
 * Build the Coinbase Managed Facilitator config.
 *
 * If CDP_API_KEY_NAME + CDP_API_KEY_PRIVATE_KEY are present we sign
 * facilitator requests with the user's CDP credentials. Otherwise we
 * fall back to the public x402.org/facilitator endpoint (testnet only).
 */
export function getFacilitator(): FacilitatorConfig {
  const id = process.env.CDP_API_KEY_NAME;
  const secret = process.env.CDP_API_KEY_PRIVATE_KEY;
  // The facilitator config from @coinbase/x402 is structurally identical to
  // x402-hono's expected FacilitatorConfig but typed against @x402/core. Cast
  // through unknown to bridge the duplicate type identities.
  if (id && secret) {
    return createFacilitatorConfig(id, secret) as unknown as FacilitatorConfig;
  }
  return managedFacilitator as unknown as FacilitatorConfig;
}

/**
 * Routes that are paywalled by x402.
 *
 * `/api/scrape` is the canonical paid endpoint at $0.05 USDC on Base.
 * Add more entries here to gate additional routes through the same
 * facilitator without hand-rolling 402 responses.
 */
export function buildRoutes(): RoutesConfig {
  return {
    'POST /api/scrape': {
      price: X402_PRICE_USD,
      network: X402_NETWORK,
      config: {
        description:
          'EL-BADOO Cloud Scraping Hub — pay-per-call product page scraping. ScraperAPI residential rotation with JS rendering. Returns normalized JSON (product_name, current_price, currency, in_stock, timestamp).',
        mimeType: 'application/json',
        maxTimeoutSeconds: 60,
        outputSchema: {
          input: { url: 'string — full product page URL' },
          output: {
            product_name: 'string',
            current_price: 'number | null',
            currency: 'string (ISO 4217)',
            in_stock: 'boolean',
            timestamp: 'string (ISO 8601)',
            meta: { source: 'string', attempts: 'number', http_status: 'number' },
          },
        },
      },
    },
  };
}

/**
 * Returns a Hono middleware that enforces the x402 paywall on the
 * routes declared in `buildRoutes()`, using the Coinbase managed
 * facilitator. Throws at startup if the receiver address is missing.
 */
export function buildPaywall() {
  const receiver = getReceiver();
  const routes = buildRoutes();
  const facilitator = getFacilitator();
  return paymentMiddleware(receiver, routes, facilitator);
}
