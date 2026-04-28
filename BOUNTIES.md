# PR_Airbnb — Airbnb Market Intelligence

**Bounty issue:** #78
**Difficulty / payout:** $75, Medium-Hard

## Endpoints in this PR

- `GET  /api/airbnb/search`
- `GET  /api/airbnb/listing/:id`
- `GET  /api/airbnb/reviews/:listing_id`
- `GET  /api/airbnb/market-stats`

## Files included

- Scrapers (only): `src/scrapers/airbnb-scraper.ts`
- Routes: only this group's routes remain in `src/service.ts` (all unrelated handlers, sub-routers, and scraper imports stripped).
- Discovery: `src/index.ts` advertises only this group's endpoints.
- Shared infra (unchanged): `src/payment.ts`, `src/proxy.ts`, `src/types/`, `src/utils/`.
- `src/routes/` and `src/analysis/` are removed (they belonged to the unrelated /api/research and /api/trending sub-routers).
- Sanitized: `.env.example` uses `<YOUR_*>` placeholders, `.replit` carries no wallet addresses.

## How to submit

From the master repo:

```bash
./stage_bounty.sh PR_Airbnb
bun install
bunx tsc --noEmit
bash test_x402.sh
git add -A && git commit -m 'Bounty: airbnb submission'
git push -u origin bounty-airbnb
```

Then open a PR against `bolivian-peru/marketplace-service-template` referencing issue #78.
