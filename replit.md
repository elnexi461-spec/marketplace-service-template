# EL-BADOO Premium 4G Scraping Hub

## Overview
A Hono-based HTTP API server (running on Bun) that exposes scraping services gated by the **Coinbase x402** paywall using the **Managed Facilitator**. The flagship endpoint is `POST /api/scrape` at **$0.05 USDC on Base** per successful request. Additional endpoints (Maps, SERP, jobs, reviews, LinkedIn, Reddit, Instagram, Airbnb, research, trending) are mounted from `src/service.ts` and continue to use the legacy custom payment helper.

## Tech Stack
- Runtime: **Bun 1.x**
- Framework: **Hono 4**
- Language: TypeScript
- Paywall: **`x402-hono` + `@coinbase/x402`** (Coinbase Managed Facilitator). `x402-express` is the Express equivalent — we use the Hono build because the app is Hono-based.
- Browser automation: **`playwright-core`** (slim runtime) + `playwright-extra` + `puppeteer-extra-plugin-stealth`, launched with `--single-process` for 2 GB RAM devices.
- No frontend — JSON HTTP API only.

## x402 Paywall (Coinbase Managed Facilitator)
Configured in `src/x402-config.ts`:
- Reads `CDP_API_KEY_NAME`, `CDP_API_KEY_PRIVATE_KEY`, `USDC_RECEIVER_ADDRESS` from Replit Secrets.
- Uses `@coinbase/x402`'s `createFacilitatorConfig(apiKeyId, apiKeySecret)` to sign verify/settle calls against the Coinbase facilitator.
- Mounts `paymentMiddleware` from `x402-hono` on `POST /api/scrape` at **$0.05 USDC on Base**.
- Falls back to the public `x402.org/facilitator` (testnet) if CDP creds are missing.

## Runtime Resilience (`src/scraper-watchdog.ts`)

A per-scraper circuit-breaker registry sits in front of every scraper call site
in `src/service.ts` (~26 endpoints, all wrapped via `safeScrape(name, fn)`).
When a scraper fails 5 times in a row (DOM change, target outage, etc.) the
breaker opens for 60 s; subsequent requests get a **503 + `Retry-After`** from
the global `onError` handler instead of crashing the worker. After cooldown
the breaker enters `half-open` and one trial call is allowed; success closes
the breaker, failure re-opens it.

Operational endpoints:
- `GET /health` → includes `scrapers: { total, open, halfOpen, closed }`
- `GET /health/scrapers` → full breaker registry snapshot
- `POST /admin/scrapers/:name/reset` → manual breaker reset

Crash safety: `process.on('uncaughtException' | 'unhandledRejection')` logs
the error and keeps the worker alive instead of exiting.

## Self-Healing Engine (`src/self-healing.ts`)
`withSelfHealing(op, options)` wraps any scraping operation with an **error-recovery circuit breaker**:
- **403 Forbidden** → 30-second wait for the 4G mobile IP to rotate, then retry.
- **Timeout** → linear backoff retry.
- **DOM mismatch** → fallback selector pass + HTML structure log via `onDomMismatch`, retry.
- **Other** (network / unknown) → exponential backoff.
- **Hard cap: 3 attempts**, then returns a settled failure (HTTP 500 envelope) so the caller can respond cleanly without wasting payment data.

`classifyFailure(err)` inspects an error / `{ http_status, error }` envelope and returns one of `forbidden_403 | timeout | dom_mismatch | network | unknown`. Throw `CircuitBreakerError(kind, message, htmlSnippet?)` from your operation to force a specific classification.

## Discovery Extension (`src/discovery.ts`)
`declareDiscoveryExtension({ baseUrl?, resourcePath?, extra? })` builds the metadata that the **Coinbase Bazaar** and other agent indexers consume:
- Name: `EL-BADOO Premium 4G Scraping Hub`
- Description: `High-trust, mobile-first lead enrichment via authentic Nigerian 4G cluster. 30s IP rotation enabled.`
- Network: `base`, Asset: USDC, Price: `$0.05`, payTo: `USDC_RECEIVER_ADDRESS`.
- Capabilities + tags + EL-BADOO-specific `extra` (proxy region, IP rotation, runtime, browser).

Served live at `GET /.well-known/x402` and exported from `src/index.ts` for static tooling.

## Project Layout
- `src/index.ts` — Hono entry: middleware, x402 paywall mount, discovery, catalog, mounts `/api`.
- `src/x402-config.ts` — paywall + Managed Facilitator wiring.
- `src/self-healing.ts` — circuit-breaker / retry / classification.
- `src/discovery.ts` — Bazaar discovery extension.
- `src/service.ts` — `serviceRouter` mounted at `/api`. `POST /api/scrape` runs the self-healing wrapper around `scrapePrice`. Other endpoints (`/api/run`, `/api/jobs`, `/api/reviews/*`, etc.) keep their existing per-route payment logic.
- `src/scrapers/price-monitor.ts` — Playwright-Core / Chromium scraper with `--single-process`.
- `src/scrapers/*` — per-source scrapers (maps, reviews, jobs, linkedin, reddit, instagram, airbnb, etc.).
- `src/payment.ts`, `src/proxy.ts` — legacy x402 verify helper + Proxies.sx proxy helpers.
- `listings/`, `tests/` — JSON listings + Bun test files.

## Running Locally
The "Start application" workflow runs:
```
PORT=5000 bun run src/index.ts
```
Bound to `0.0.0.0:5000`. Useful endpoints:
- `GET /` — service catalog with paywall + self-healing config
- `GET /health` — health check (`paywall: active|misconfigured`)
- `GET /.well-known/x402` — discovery extension JSON
- `POST /api/scrape` — paid endpoint ($0.05 USDC on Base, Coinbase Managed Facilitator)

## Unified Receiver Wallet

All paid endpoints — both the new x402 paywall (`POST /api/scrape`) and the
legacy per-route gates (LinkedIn / Instagram / Maps / Reviews / Reddit /
Airbnb / SERP) — settle to the **same USDC-on-Base wallet** resolved from:

```
USDC_RECEIVER_ADDRESS → WALLET_ADDRESS_BASE → WALLET_ADDRESS
```

`build402Response` in `src/payment.ts` only advertises networks that actually
match the wallet's address format (EVM 0x… → Base only; base58 → Solana only)
so clients cannot accidentally pay on a network that the recipient cannot
receive on.

## Required Secrets
Set in Replit Secrets:
- `CDP_API_KEY_NAME` — Coinbase Developer Platform key id
- `CDP_API_KEY_PRIVATE_KEY` — CDP key secret
- `USDC_RECEIVER_ADDRESS` — Base wallet that receives USDC

Optional:
- `WALLET_ADDRESS_BASE` / `WALLET_ADDRESS` — fallbacks for receiver, also used by legacy endpoints.
- `SCRAPE_TIMEOUT_MS` — Playwright nav timeout (default 5000).
- `RATE_LIMIT` — req/min per IP (default 60).
- `PUBLIC_BASE_URL` — overrides discovery `resource` URL.

## Deployment
- **Replit Autoscale** is configured (`bun run src/index.ts`). The Nix layer provides Chromium + libs.
- **Railway / Coolify**: see `nixpacks.toml`.
- **Docker**: see `Dockerfile`.
