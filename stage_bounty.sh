#!/usr/bin/env bash
#
# stage_bounty.sh — swap a PR_X folder into the live src/ on its own git branch.
#
#   Usage:  ./stage_bounty.sh PR_LinkedIn
#
# What it does:
#   1. Creates (or switches to) git branch  bounty-<slug>
#   2. Wipes the live src/  and replaces it with PR_X/src/
#   3. Replaces BOUNTIES.md  with the focused PR_X/BOUNTIES.md
#   4. Replaces .env.example with PR_X/.env.example  (already sanitized)
#   5. Leaves the PR_X folder intact so you can re-stage another bounty later
#
# After it finishes:
#   bun install
#   bunx tsc --noEmit
#   bash test_x402.sh
#   git add -A && git commit -m 'Bounty: <slug> submission'
#   git push -u origin bounty-<slug>
#
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <PR_FolderName>"
  echo "  Available: PR_LinkedIn  PR_Airbnb  PR_Maps  PR_Instagram  PR_Twitter  PR_Trending"
  exit 1
fi

PR="$1"
[ -d "$PR" ]      || { echo "Error: folder $PR not found at repo root"; exit 1; }
[ -d "$PR/src" ]  || { echo "Error: $PR/src not found"; exit 1; }

slug=$(echo "$PR" | sed 's/^PR_//' | tr '[:upper:]' '[:lower:]')
BRANCH="bounty-${slug}"

# Refuse if there are uncommitted changes — protects the master copy
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "Error: working tree has uncommitted changes."
  echo "       Commit or stash them first so master src/ stays preserved on the main branch."
  echo "       (Run 'git status' to see what's pending.)"
  exit 1
fi

echo "→ Creating/switching to git branch '$BRANCH'..."
if git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  git checkout "$BRANCH"
else
  git checkout -b "$BRANCH"
fi

echo "→ Wiping current src/..."
rm -rf src

echo "→ Copying $PR/src/ → src/..."
cp -a "$PR/src" src

if [ -f "$PR/BOUNTIES.md" ]; then
  echo "→ Replacing BOUNTIES.md with focused $PR/BOUNTIES.md..."
  cp -a "$PR/BOUNTIES.md" BOUNTIES.md
fi

if [ -f "$PR/.env.example" ]; then
  echo "→ Refreshing .env.example from $PR/.env.example (sanitized)..."
  cp -a "$PR/.env.example" .env.example
fi

echo
echo "✔ Staged $PR onto branch '$BRANCH'."
echo
echo "Next steps:"
echo "  bun install"
echo "  bunx tsc --noEmit"
echo "  bash test_x402.sh"
echo "  git add -A && git commit -m 'Bounty: $slug submission'"
echo "  git push -u origin $BRANCH"
echo
echo "To return to your master copy when done:"
echo "  git checkout main      # or whichever your default branch is"
