# PR_Twitter — X / Twitter Real-Time Search

**Bounty issue:** #281, #73
**Difficulty / payout:** $100, Hard — scaffolded, awaiting routes

## Endpoints in this PR

- `(no routes wired yet — twitter.ts scraper provided as the deliverable starting point)`

## Files included

- Scrapers (only): `src/scrapers/twitter.ts`
- Routes: only this group's routes remain in `src/service.ts` (all unrelated handlers, sub-routers, and scraper imports stripped).
- Discovery: `src/index.ts` advertises only this group's endpoints.
- Shared infra (unchanged): `src/payment.ts`, `src/proxy.ts`, `src/types/`, `src/utils/`.
- `src/routes/` and `src/analysis/` are removed (they belonged to the unrelated /api/research and /api/trending sub-routers).
- Sanitized: `.env.example` uses `<YOUR_*>` placeholders, `.replit` carries no wallet addresses.

## How to submit

From the master repo:

```bash
./stage_bounty.sh PR_Twitter
bun install
bunx tsc --noEmit
bash test_x402.sh
git add -A && git commit -m 'Bounty: twitter submission'
git push -u origin bounty-twitter
```

Then open a PR against `bolivian-peru/marketplace-service-template` referencing issue #281, #73.
