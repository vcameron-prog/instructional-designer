#!/usr/bin/env bash
# check-links.sh — scan client/src/, server/, and shared/ for hardcoded external hrefs and verify each resolves with 2xx.
# Excludes test files (*.test.tsx / *.test.ts) and placeholder= attributes.
# Usage: bash scripts/check-links.sh
# Exits 0 if all links are reachable, 1 if any return 4xx/5xx or are unreachable.

set -euo pipefail

SEARCH_DIRS=("client/src" "server" "shared")
FAIL=0
CHECKED=0

# Connectivity pre-check: try two or more known reliable hosts in sequence.
# Only skips the full link check if every probe returns 000 (no response at all).
# This prevents a false "offline" result on networks that block Google but
# allow other outbound traffic (e.g. Cloudflare DNS or GitHub).
CONNECTIVITY_HOSTS=("https://www.google.com" "https://1.1.1.1" "https://github.com")
CONNECTIVITY_OK=0
for CONNECTIVITY_HOST in "${CONNECTIVITY_HOSTS[@]}"; do
  CONNECTIVITY_CODE=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 10 "$CONNECTIVITY_HOST" 2>/dev/null || echo "000")
  if [[ "$CONNECTIVITY_CODE" != "000" ]]; then
    CONNECTIVITY_OK=1
    break
  fi
done
if [[ "$CONNECTIVITY_OK" == "0" ]]; then
  echo "WARNING: Outbound HTTP unavailable (connectivity checks to all fallback hosts returned 000)."
  echo "  Probed hosts: ${CONNECTIVITY_HOSTS[*]}"
  echo "Skipping external link check — no network access in this environment."
  exit 0
fi

# Extract unique https:// URLs from href= attributes in non-test .tsx/.ts source files
# across client/src/, server/, and shared/.
# Excludes placeholder="https://..." values (those are UX hints, not real links).
mapfile -t URLS < <(
  grep -roh \
    --include="*.tsx" \
    --include="*.ts" \
    --exclude="*.test.tsx" \
    --exclude="*.test.ts" \
    'href="https://[^"]*"' \
    "${SEARCH_DIRS[@]}" \
  | grep -oP 'https://[^"]+' \
  | sort -u
)

DIRS_LABEL="${SEARCH_DIRS[*]}"

if [[ ${#URLS[@]} -eq 0 ]]; then
  echo "No external hrefs found in ${DIRS_LABEL} — nothing to check."
  exit 0
fi

echo "Checking ${#URLS[@]} external link(s) found in ${DIRS_LABEL} ..."
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
