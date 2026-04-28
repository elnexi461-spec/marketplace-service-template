# PR_Instagram — Instagram Intelligence + AI Vision

**Bounty issue:** #71
**Difficulty / payout:** $200, Hard

## Endpoints in this PR

- `GET /api/instagram/profile/:username`
- `GET /api/instagram/posts/:username`
- `GET /api/instagram/analyze/:username`
- `GET /api/instagram/analyze/:username/images`
- `GET /api/instagram/audit/:username`

## Files included

- Scrapers (only): `src/scrapers/instagram-scraper.ts`
- Routes: only this group's routes remain in `src/service.ts` (all unrelated handlers, sub-routers, and scraper imports stripped).
- Discovery: `src/index.ts` advertises only this group's endpoints.
- Shared infra (unchanged): `src/payment.ts`, `src/proxy.ts`, `src/types/`, `src/utils/`.
- `src/routes/` and `src/analysis/` are removed (they belonged to the unrelated /api/research and /api/trending sub-routers).
- Sanitized: `.env.example` uses `<YOUR_*>` placeholders, `.replit` carries no wallet addresses.

## How to submit

From the master repo:

```bash
./stage_bounty.sh PR_Instagram
bun install
bunx tsc --noEmit
bash test_x402.sh
git add -A && git commit -m 'Bounty: instagram submission'
git push -u origin bounty-instagram
```

Then open a PR against `bolivian-peru/marketplace-service-template` referencing issue #71.
