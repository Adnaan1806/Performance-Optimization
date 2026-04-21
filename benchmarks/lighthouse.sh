#!/usr/bin/env bash
#
# Runs Lighthouse (desktop preset) against the 4 challenge pages and
# drops JSON + HTML reports into ./results/.
#
# Prereqs:
#   npm install -g lighthouse
#   frontend is serving on $BASE (default http://localhost:5173)

set -euo pipefail

BASE="${BASE:-http://localhost:5173}"
OUT="${OUT:-./results}"
mkdir -p "$OUT"

STAMP=$(date +%Y%m%d-%H%M%S)

run_page() {
  local slug="$1"
  local url="$2"
  echo "--- Lighthouse: $url"
  lighthouse "$url" \
    --preset=desktop \
    --output=json --output=html \
    --output-path="$OUT/${slug}-${STAMP}" \
    --chrome-flags="--headless --no-sandbox" \
    --quiet
}

run_page "home"       "$BASE/"
run_page "products"   "$BASE/products"
run_page "product"    "$BASE/products/1"
run_page "search"     "$BASE/search?q=Pro"

echo
echo "Reports written to $OUT/"
echo "Open the .report.html files in a browser to review."
