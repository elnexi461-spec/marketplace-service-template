# Bounty Submission Manifest

This document groups all live `/api/*` endpoints by their target GitHub bounty issue so each
group can be cherry-picked into its own Pull Request without code reorganization.

All routes are mounted under `/api` from `src/service.ts` (router declared once in `src/index.ts`).
The "Files to include" lists below are the **exact files that must travel together** in each PR
for that group's endpoints to function in isolation.

**Total endpoints catalogued: 28** (under `/api/*`, excluding `/` and `/health`).

---

## Shared Files (every PR needs these)

These files are infrastructure that every endpoint depends on. Any PR that adds a route from
`src/service.ts` will conflict on this file unless coordinated.

| File | Purpose |
|------|---------|
| `src/index.ts` | App bootstrap, CORS, rate limiting, service discovery (`GET /`, `GET /health`), wallet config (`getRecipients`) |
| `src/service.ts` | Router for every `/api/*` endpoint (split per-PR by route block) |
| `src/payment.ts` | x402 verification (Solana + Base), replay protection, `extractPayment`, `verifyPayment`, `build402Response`, `build402BaseOnly` |
| `src/proxy.ts` | Proxies.sx mobile-proxy fetch helper, `getProxy`, `getProxyExitIp` |
| `src/types/index.ts` | Shared TypeScript interfaces |
| `src/utils/helpers.ts` | Extraction helpers |
| `package.json`, `tsconfig.json`, `bun.lockb` | Runtime + types |
| `.env.example` | Env-var template (sanitized — no real wallets) |

---

## Group 1 — Instagram (Issue #71)

**Bounty:** Instagram Intelligence + AI Vision ($200, Hard)
**Endpoints in this PR:** 5
**Status:** Live, x402-gated, OpenAI vision wired for analyze endpoints.

| # | Method | Path | Price (USDC) | Handler in `src/service.ts` |
|---|--------|------|--------------|-----------------------------|
| 1 | GET | `/api/instagram/profile/:username` | 0.01 | line 1175 |
| 2 | GET | `/api/instagram/posts/:username` | 0.02 | line 1220 |
| 3 | GET | `/api/instagram/analyze/:username` | 0.15 | line 1270 |
| 4 | GET | `/api/instagram/analyze/:username/images` | 0.08 | line 1317 |
| 5 | GET | `/api/instagram/audit/:username` | 0.05 | line 1363 |

**Files to include in PR:**
- `src/scrapers/instagram-scraper.ts` (only file in `src/scrapers/` this group needs)
- The 5 route blocks above from `src/service.ts`
- Shared files (see top section)

---

## Group 2 — LinkedIn (Issue #77)

**Bounty:** LinkedIn People Enrichment ($100, Hard)
**Endpoints in this PR:** 4
**Status:** Live, iPhone 14 mobile fingerprint, x402-gated.

| # | Method | Path | Price (USDC) | Handler in `src/service.ts` |
|---|--------|------|--------------|-----------------------------|
| 1 | GET | `/api/linkedin/person` | 0.01 | line 711 |
| 2 | GET | `/api/linkedin/company` | 0.01 | line 773 |
| 3 | GET | `/api/linkedin/search/people` | 0.01 | line 834 |
| 4 | GET | `/api/linkedin/company/:id/employees` | 0.01 | line 893 |

**Files to include in PR:**
- `src/scrapers/linkedin-enrichment.ts`
- The 4 route blocks above from `src/service.ts`
- Shared files

---

## Group 3 — Airbnb (Issue #78)

**Bounty:** Airbnb Market Intelligence ($75, Medium-Hard)
**Endpoints in this PR:** 4
**Status:** Live, x402-gated.

| # | Method | Path | Price (USDC) | Handler in `src/service.ts` |
|---|--------|------|--------------|-----------------------------|
| 1 | GET | `/api/airbnb/search` | 0.02 | line 1418 |
| 2 | GET | `/api/airbnb/listing/:id` | 0.01 | line 1469 |
| 3 | GET | `/api/airbnb/reviews/:listing_id` | 0.01 | line 1509 |
| 4 | GET | `/api/airbnb/market-stats` | 0.05 | line 1554 |

**Files to include in PR:**
- `src/scrapers/airbnb-scraper.ts`
- The 4 route blocks above from `src/service.ts`
- Shared files

---

## Group 4 — Google Maps / Reviews / SERP (Issue #91)

**Bounty:** Google Maps + Reviews + SERP family
**Endpoints in this PR:** 8
**Status:** Live. SERP uses Playwright + iPhone 14 stealth (returns clean
CAPTCHA error from datacenter IPs — needs residential/mobile proxy in prod).

| # | Method | Path | Price (USDC) | Handler in `src/service.ts` |
|---|--------|------|--------------|-----------------------------|
| 1 | GET | `/api/run` | 0.005 | line 240 |
| 2 | GET | `/api/details` | 0.005 | line 327 |
| 3 | GET | `/api/reviews/search` | 0.01 | line 514 |
| 4 | GET | `/api/reviews/summary/:place_id` | 0.005 | line 561 |
| 5 | GET | `/api/reviews/:place_id` | 0.02 | line 604 |
| 6 | GET | `/api/business/:place_id` | 0.01 | line 658 |
| 7 | GET | `/api/serp` | 0.003 (Base only) | line 1688 |
| 8 | POST | `/api/serp` | 0.003 (Base only) | line 1689 |

**Files to include in PR:**
- `src/scrapers/maps-scraper.ts`
- `src/scrapers/reviews/` (entire folder — Google Reviews implementation)
- `src/scrapers/serp-playwright.ts` (Playwright + stealth — currently wired)
- The 8 route blocks above from `src/service.ts`
- Shared files

> Note: `src/scrapers/serp-tracker.ts` exists but is **not currently imported** by `src/service.ts`. It is a legacy/alternative implementation. Decide before PR whether to include it or delete it.

---

## Group 5 — Twitter / X Search (Issues #281 and #73)

**Bounties:** X/Twitter Real-Time Search ($100, Hard) + related
**Endpoints in this PR:** 0 routes currently mounted
**Status:** ⚠️ Scraper file exists but no routes wired in `src/service.ts`.

**What's in the repo:**
- `src/scrapers/twitter.ts` (11.3 KB) — scraper module present, exports not yet referenced

**To complete this PR you will need to:**
1. Wire route handlers in `src/service.ts` (e.g. `/api/twitter/search`, `/api/twitter/profile`) following the same x402 pattern as the LinkedIn or Reddit groups.
2. Add the new endpoints to the discovery JSON in `src/index.ts`.

**Files to include in PR (when wired):**
- `src/scrapers/twitter.ts`
- New route blocks added to `src/service.ts`
- Updated discovery list in `src/index.ts`
- Shared files

---

## Group 6 — Trending / Social (Issues #70 and #149)

**Bounties:** Trend Intelligence (Cross-Platform) + Reddit Intelligence
**Endpoints in this PR:** 4 (all Reddit-based today)
**Status:** Live, x402-gated. Discovery JSON in `src/index.ts` advertises `/api/trending` and `/api/research` endpoints that are **not yet implemented** as handlers — see notes below.

| # | Method | Path | Price (USDC) | Handler in `src/service.ts` |
|---|--------|------|--------------|-----------------------------|
| 1 | GET | `/api/reddit/search` | 0.005 | line 958 |
| 2 | GET | `/api/reddit/trending` | 0.005 | line 1013 |
| 3 | GET | `/api/reddit/subreddit/:name` | 0.005 | line 1056 |
| 4 | GET | `/api/reddit/thread/*` | 0.01 | line 1111 |

**Files to include in PR:**
- `src/scrapers/reddit-scraper.ts` (the Bounty #68 implementation, currently wired)
- The 4 route blocks above from `src/service.ts`
- Shared files

> Notes:
> - `src/scrapers/reddit.ts` (older draft) is **not imported anywhere** — safe to delete or exclude from this PR.
> - `src/scrapers/youtube.ts` and `src/scrapers/web.ts` exist but no routes wired — candidates to expand cross-platform trend coverage for Issue #70.
> - Discovery JSON advertises `GET /api/research` and `GET /api/trending` but no handlers exist for them. Either wire them up before submission or remove from discovery list.

---

## Out-of-Scope Endpoints (not part of any listed bounty group)

These 3 endpoints exist but don't map to the six bounty groups above. Keep them in the main repo or split into their own PR.

| # | Method | Path | Price (USDC) | Handler in `src/service.ts` | Scraper file |
|---|--------|------|--------------|-----------------------------|--------------|
| 1 | POST | `/api/scrape` | 0.002 (Base only) | line 88 | `src/scrapers/price-monitor.ts` |
| 2 | GET | `/api/scrape` | landing page | line 176 | (same as above) |
| 3 | GET | `/api/jobs` | 0.005 | line 397 | `src/scrapers/job-scraper.ts` |

---

## Endpoint Count Summary

| Group | Issue(s) | Live Endpoints |
|-------|----------|----------------|
| Instagram | #71 | 5 |
| LinkedIn | #77 | 4 |
| Airbnb | #78 | 4 |
| Google Maps / Reviews / SERP | #91 | 8 |
| Twitter / X Search | #281, #73 | 0 (scraper present, not wired) |
| Trending / Social (Reddit) | #70, #149 | 4 |
| Out-of-scope (price monitor + jobs) | — | 3 |
| **Total** | | **28** |

---

## Per-PR Checklist

For each bounty PR:

1. Branch from `main`: `git checkout -b bounty-<issue-number>-<short-name>`
2. Copy in only the files listed in that group's "Files to include" section, plus the shared files.
3. Trim `src/service.ts` to only that group's route blocks (and any shared imports they need).
4. Trim the `endpoints[]` array in `src/index.ts` so the discovery JSON only lists this group's routes.
5. Update `.env.example` if your group introduces new env keys.
6. Run `bunx tsc --noEmit` — must be clean.
7. Run `bash test_x402.sh` — confirm 402 gating still works.
8. Deploy to Replit / Render / Fly, capture the public URL + a sample 402 response + a sample paid response.
9. Open PR against [`bolivian-peru/marketplace-service-template`](https://github.com/bolivian-peru/marketplace-service-template) referencing the bounty issue number.
