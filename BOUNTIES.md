# PR_Maps — Google Maps + Reviews + SERP

**Bounty issue:** #91
**Difficulty / payout:** Combined Maps family

## Endpoints in this PR

- `GET  /api/run`
- `GET  /api/details`
- `GET  /api/reviews/search`
- `GET  /api/reviews/summary/:place_id`
- `GET  /api/reviews/:place_id`
- `GET  /api/business/:place_id`
- `GET  /api/serp`
- `POST /api/serp`

## Files included

- Scrapers (only): `src/scrapers/maps-scraper.ts`, `src/scrapers/serp-playwright.ts`, `src/scrapers/reviews/`
- Routes: only this group's routes remain in `src/service.ts` (all unrelated handlers, sub-routers, and scraper imports stripped).
- Discovery: `src/index.ts` advertises only this group's endpoints.
- Shared infra (unchanged): `src/payment.ts`, `src/proxy.ts`, `src/types/`, `src/utils/`.
- `src/routes/` and `src/analysis/` are removed (they belonged to the unrelated /api/research and /api/trending sub-routers).
- Sanitized: `.env.example` uses `<YOUR_*>` placeholders, `.replit` carries no wallet addresses.

## How to submit

From the master repo:

```bash
./stage_bounty.sh PR_Maps
bun install
bunx tsc --noEmit
bash test_x402.sh
git add -A && git commit -m 'Bounty: maps submission'
git push -u origin bounty-maps
```

Then open a PR against `bolivian-peru/marketplace-service-template` referencing issue #91.
