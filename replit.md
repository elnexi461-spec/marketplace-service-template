# Marketplace Service Template

## Overview
A Hono-based HTTP API server (running on Bun) that exposes x402-gated services on top of Proxies.sx mobile proxy infrastructure. Endpoints include Google Maps, SERP tracking, job listings, reviews, LinkedIn, Reddit, Instagram, Airbnb, and trend research.

## Tech Stack
- Runtime: Bun 1.x
- Framework: Hono 4
- Language: TypeScript
- Scraping: Playwright (Chromium) + `puppeteer-extra-plugin-stealth` via `playwright-extra`
- No frontend — JSON HTTP API only

## E-Commerce Price & Stock Monitor (Bounty Wave 2)
`POST /api/scrape` — gated by x402 V2 at **0.002 USDC on Base** (= 2000 base units).

Body:
```json
{ "url": "https://www.amazon.com/dp/..." }
```

Response (after payment):
```json
{
  "product_name": "string",
  "current_price": 0.00,
  "currency": "USD",
  "in_stock": true,
  "timestamp": "2026-04-24T00:00:00Z",
  "meta": { "source": "amazon|ebay|generic", "attempts": 1, "used_user_agent": "...", "http_status": 200 },
  "payment": { "txHash": "0x...", "network": "base", "amount": 0.002, "settled": true }
}
```

Scraper guarantees:
- Headless Chromium with mobile emulation (iPhone / Pixel / Galaxy UA + viewport)
- CSS / images / fonts / media blocked at the network level for speed
- 5 s page-load timeout (override with `SCRAPE_TIMEOUT_MS`)
- Self-heal: if the first attempt fails or hits a bot wall, retry once with a different mobile UA + viewport
- Graceful 404 / out-of-stock handling — never crashes the service
- Falls back to JSON-LD / OpenGraph parsing when site-specific selectors miss

## Project Layout
- `src/index.ts` — server entry (Hono app, middleware, routes mount)
- `src/service.ts` — main `serviceRouter` mounted at `/api`
- `src/routes/` — additional routers (research, trending)
- `src/scrapers/` — per-source scrapers (maps, reviews, jobs, linkedin, reddit, instagram, airbnb, etc.)
- `src/payment.ts`, `src/proxy.ts` — x402 payment + Proxies.sx proxy helpers
- `src/analysis/`, `src/utils/`, `src/types/` — supporting modules
- `listings/` — JSON service listings
- `tests/` — Bun test files

## Running Locally
The "Start application" workflow runs:
```
PORT=5000 bun run src/index.ts
```
The server binds `0.0.0.0:5000`. Useful endpoints:
- `GET /` — service catalog with pricing
- `GET /health` — health check
- `GET /api/*` — per-service routes (most require x402 payment headers; see `DEMO-ENDPOINTS.md`)

## Configuration
Environment variables (see `.env.example`):
- `WALLET_ADDRESS`, `WALLET_ADDRESS_BASE` — payout wallets
- `SCRAPE_PRICE_USDC` (default `0.002`), `SCRAPE_TIMEOUT_MS` (default `5000`) — price-monitor settings
- `SERVICE_NAME`, `SERVICE_DESCRIPTION`, `PRICE_USDC`, etc. — service metadata
- `PROXY_HOST`, `PROXY_HTTP_PORT`, `PROXY_USER`, `PROXY_PASS`, `PROXY_COUNTRY` — Proxies.sx credentials
- `PORT` (defaults to 3000; the Replit workflow sets it to 5000)
- `RATE_LIMIT` — requests per minute per IP
- `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` / `REPLIT_LD_LIBRARY_PATH` — auto-set by the Nix `playwright-driver` package; the workflow forwards them to the Bun process so Playwright can launch.

## Verifying the x402 Flow
Run the included test script (no real USDC needed):
```bash
./test_x402.sh
# or with a real Base tx hash to exercise the full happy path:
./test_x402.sh --with-payment 0x<tx_hash>
```

## Deployment
- **Replit Autoscale**: configured (`bun run src/index.ts`) — Replit's Nix layer provides the Chromium binary + libraries automatically.
- **Railway / Coolify**: see `nixpacks.toml`.
- **Docker**: see `Dockerfile` (uses `mcr.microsoft.com/playwright` base for pre-installed Chromium libs).
