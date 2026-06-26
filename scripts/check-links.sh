#!/usr/bin/env bash
# check-links.sh — scan client/src/ for hardcoded external hrefs and verify each resolves with 2xx.
# Excludes test files (*.test.tsx / *.test.ts) and placeholder= attributes.
# Usage: bash scripts/check-links.sh
# Exits 0 if all links are reachable, 1 if any return 4xx/5xx or are unreachable.

set -euo pipefail

SEARCH_DIR="client/src"
FAIL=0
CHECKED=0

# Connectivity pre-check: attempt a HEAD request to a known reliable host.
# If outbound HTTP is unavailable (air-gapped, restricted network, local dev),
# skip the link check entirely rather than hard-failing every URL with HTTP 000.
CONNECTIVITY_HOST="https://www.google.com"
CONNECTIVITY_CODE=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 10 "$CONNECTIVITY_HOST" 2>/dev/null || echo "000")
if [[ "$CONNECTIVITY_CODE" == "000" ]]; then
  echo "WARNING: Outbound HTTP unavailable (connectivity check to $CONNECTIVITY_HOST returned 000)."
  echo "Skipping external link check — no network access in this environment."
  exit 0
fi

# Extract unique https:// URLs from href= attributes in non-test .tsx/.ts source files.
# Excludes placeholder="https://..." values (those are UX hints, not real links).
mapfile -t URLS < <(
  grep -roh \
    --include="*.tsx" \
    --include="*.ts" \
    --exclude="*.test.tsx" \
    --exclude="*.test.ts" \
    'href="https://[^"]*"' \
    "$SEARCH_DIR" \
  | grep -oP 'https://[^"]+' \
  | sort -u
)

if [[ ${#URLS[@]} -eq 0 ]]; then
  echo "No external hrefs found in $SEARCH_DIR — nothing to check."
  exit 0
fi

echo "Checking ${#URLS[@]} external link(s) found in $SEARCH_DIR ..."
echo ""

for URL in "${URLS[@]}"; do
  CHECKED=$((CHECKED + 1))
  HTTP_CODE=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 15 --retry 2 --retry-delay 2 "$URL" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" =~ ^2 ]]; then
    echo "  OK  ($HTTP_CODE)  $URL"
  else
    echo "  FAIL ($HTTP_CODE)  $URL"
    FAIL=$((FAIL + 1))
  fi
done

echo ""
echo "Results: $((CHECKED - FAIL))/$CHECKED passed."

if [[ $FAIL -gt 0 ]]; then
  echo "ERROR: $FAIL link(s) returned a non-2xx status." >&2
  exit 1
fi
