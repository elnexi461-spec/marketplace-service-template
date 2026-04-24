#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# test_x402.sh — verify the /api/scrape x402 challenge/response
# flow without burning real USDC.
#
# Usage:
#   ./test_x402.sh                       # uses http://localhost:5000
#   BASE_URL=https://your.app ./test_x402.sh
#   ./test_x402.sh --with-payment 0xTXHASH
#
# What it checks:
#   1. POST /api/scrape with no payment header  → 402 + correct x402 body
#   2. The 402 body lists Base @ 0.002 USDC (= 2000 base units)
#   3. POST with an invalid payment header       → 402 (verification failed)
#   4. POST with a malformed body                → 400
#   5. (optional) POST with a real Base tx hash  → 200 + product data
# ─────────────────────────────────────────────────────────────

set -u

BASE_URL="${BASE_URL:-http://localhost:5000}"
ENDPOINT="$BASE_URL/api/scrape"
TEST_PRODUCT_URL="${TEST_PRODUCT_URL:-https://www.amazon.com/dp/B08N5WRWNW}"

PASS=0
FAIL=0
RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YLW=$'\033[1;33m'; CLR=$'\033[0m'

check() {
  local name="$1"; local cond="$2"
  if eval "$cond"; then
    echo "${GRN}✓${CLR} $name"; PASS=$((PASS+1))
  else
    echo "${RED}✗${CLR} $name"; FAIL=$((FAIL+1))
  fi
}

section() { echo; echo "${YLW}── $1 ──${CLR}"; }

# ─── 1. NO PAYMENT HEADER ───
section "Test 1 — POST /api/scrape with no payment header"
RESP=$(curl -s -o /tmp/x402_resp.json -w "%{http_code}" \
  -X POST "$ENDPOINT" \
  -H 'Content-Type: application/json' \
  -d "{\"url\":\"$TEST_PRODUCT_URL\"}")
echo "HTTP status: $RESP"
cat /tmp/x402_resp.json | head -c 600; echo

check "responds with HTTP 402"            "[ \"$RESP\" = '402' ]"
check "body contains x402Version"         "grep -q '\"x402Version\"' /tmp/x402_resp.json"
check "advertises base network"           "grep -q '\"network\":\"base\"' /tmp/x402_resp.json"
check "price is 0.002 USDC"               "grep -q '\"amount\":\"0.002\"' /tmp/x402_resp.json"
check "maxAmountRequired is 2000 units"   "grep -q '\"maxAmountRequired\":\"2000\"' /tmp/x402_resp.json"
check "payTo address present"             "grep -q '\"payTo\":\"0x' /tmp/x402_resp.json"

# ─── 2. GET /scrape returns the same challenge (discovery) ───
section "Test 2 — GET /api/scrape (discovery / pricing endpoint)"
RESP=$(curl -s -o /tmp/x402_get.json -w "%{http_code}" "$ENDPOINT")
echo "HTTP status: $RESP"
check "GET returns 402"                   "[ \"$RESP\" = '402' ]"
check "GET advertises base network"       "grep -q '\"network\":\"base\"' /tmp/x402_get.json"

# ─── 3. INVALID PAYMENT HEADER ───
section "Test 3 — POST with an invalid Base tx hash"
FAKE_HASH="0x$(printf '0%.0s' {1..64})"
RESP=$(curl -s -o /tmp/x402_bad.json -w "%{http_code}" \
  -X POST "$ENDPOINT" \
  -H 'Content-Type: application/json' \
  -H "X-Payment-Network: base" \
  -H "Payment-Signature: $FAKE_HASH" \
  -d "{\"url\":\"$TEST_PRODUCT_URL\"}")
echo "HTTP status: $RESP"
cat /tmp/x402_bad.json | head -c 400; echo
check "responds with HTTP 402"                          "[ \"$RESP\" = '402' ]"
check "body explains verification failure"              "grep -qi 'verification failed' /tmp/x402_bad.json"

# ─── 4. MISSING / BAD URL ───
# Using a real-looking but invalid hash so we *pass* the format gate
# but fail at on-chain verification — server should still complain
# about the missing url with a 400 if no payment is given.
section "Test 4 — POST with no body at all (should 402, no body to parse)"
RESP=$(curl -s -o /tmp/x402_empty.json -w "%{http_code}" \
  -X POST "$ENDPOINT" -H 'Content-Type: application/json')
echo "HTTP status: $RESP"
check "still requires payment first (402)"   "[ \"$RESP\" = '402' ]"

# ─── 5. (optional) REAL PAYMENT ───
if [ "${1:-}" = "--with-payment" ] && [ -n "${2:-}" ]; then
  REAL_HASH="$2"
  section "Test 5 — POST with REAL Base tx hash $REAL_HASH"
  RESP=$(curl -s -o /tmp/x402_ok.json -w "%{http_code}" \
    -X POST "$ENDPOINT" \
    -H 'Content-Type: application/json' \
    -H "X-Payment-Network: base" \
    -H "Payment-Signature: $REAL_HASH" \
    -d "{\"url\":\"$TEST_PRODUCT_URL\"}")
  echo "HTTP status: $RESP"
  cat /tmp/x402_ok.json | head -c 800; echo
  check "responds with HTTP 200"                  "[ \"$RESP\" = '200' ]"
  check "returns product_name"                    "grep -q '\"product_name\"' /tmp/x402_ok.json"
  check "returns current_price field"             "grep -q '\"current_price\"' /tmp/x402_ok.json"
  check "returns currency"                        "grep -q '\"currency\"' /tmp/x402_ok.json"
  check "returns in_stock flag"                   "grep -q '\"in_stock\"' /tmp/x402_ok.json"
  check "marks payment as settled"                "grep -q '\"settled\":true' /tmp/x402_ok.json"
fi

# ─── SUMMARY ───
echo
echo "──────────────────────────────────"
echo "  Passed: ${GRN}$PASS${CLR}   Failed: ${RED}$FAIL${CLR}"
echo "──────────────────────────────────"
[ "$FAIL" -eq 0 ]
