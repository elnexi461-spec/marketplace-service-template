# Marketplace Service Template

## Overview
A Hono-based HTTP API server (running on Bun) that exposes x402-gated services on top of Proxies.sx mobile proxy infrastructure. Endpoints include Google Maps, SERP tracking, job listings, reviews, LinkedIn, Reddit, Instagram, Airbnb, and trend research.

## Tech Stack
- Runtime: Bun 1.x
- Framework: Hono 4
- Language: TypeScript
- No frontend — JSON HTTP API only

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
- `SERVICE_NAME`, `SERVICE_DESCRIPTION`, `PRICE_USDC`, etc. — service metadata
- `PROXY_HOST`, `PROXY_HTTP_PORT`, `PROXY_USER`, `PROXY_PASS`, `PROXY_COUNTRY` — Proxies.sx credentials
- `PORT` (defaults to 3000; the Replit workflow sets it to 5000)
- `RATE_LIMIT` — requests per minute per IP

## Deployment
Configured for autoscale deployment with run command `bun run src/index.ts`.
