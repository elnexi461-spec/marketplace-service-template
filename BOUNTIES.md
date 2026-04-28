# PR_Trending — Trending / Social Intelligence (Reddit)

**Bounty issue:** #70, #149
**Difficulty / payout:** $100 + $50

## Endpoints in this PR

- `GET /api/reddit/search`
- `GET /api/reddit/trending`
- `GET /api/reddit/subreddit/:name`
- `GET /api/reddit/thread/*`

## Files included

- Scrapers (only): `src/scrapers/reddit-scraper.ts`
- Routes: only this group's routes remain in `src/service.ts` (all unrelated handlers, sub-routers, and scraper imports stripped).
- Discovery: `src/index.ts` advertises only this group's endpoints.
- Shared infra (unchanged): `src/payment.ts`, `src/proxy.ts`, `src/types/`, `src/utils/`.
- `src/routes/` and `src/analysis/` are removed (they belonged to the unrelated /api/research and /api/trending sub-routers).
- Sanitized: `.env.example` uses `<YOUR_*>` placeholders, `.replit` carries no wallet addresses.

## How to submit

From the master repo:

```bash
./stage_bounty.sh PR_Trending
bun install
bunx tsc --noEmit
bash test_x402.sh
git add -A && git commit -m 'Bounty: trending submission'
git push -u origin bounty-trending
```

Then open a PR against `bolivian-peru/marketplace-service-template` referencing issue #70, #149.
