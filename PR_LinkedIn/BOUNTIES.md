# PR_LinkedIn — LinkedIn People Enrichment

**Bounty issue:** #77
**Difficulty / payout:** $100, Hard

## Endpoints in this PR

- `GET  /api/linkedin/person`
- `GET  /api/linkedin/company`
- `GET  /api/linkedin/search/people`
- `GET  /api/linkedin/company/:id/employees`

## Files included

- Scrapers (only): `src/scrapers/linkedin-enrichment.ts`
- Routes: only this group's routes remain in `src/service.ts` (all unrelated handlers, sub-routers, and scraper imports stripped).
- Discovery: `src/index.ts` advertises only this group's endpoints.
- Shared infra (unchanged): `src/payment.ts`, `src/proxy.ts`, `src/types/`, `src/utils/`.
- `src/routes/` and `src/analysis/` are removed (they belonged to the unrelated /api/research and /api/trending sub-routers).
- Sanitized: `.env.example` uses `<YOUR_*>` placeholders, `.replit` carries no wallet addresses.

## How to submit

From the master repo:

```bash
./stage_bounty.sh PR_LinkedIn
bun install
bunx tsc --noEmit
bash test_x402.sh
git add -A && git commit -m 'Bounty: linkedin submission'
git push -u origin bounty-linkedin
```

Then open a PR against `bolivian-peru/marketplace-service-template` referencing issue #77.
