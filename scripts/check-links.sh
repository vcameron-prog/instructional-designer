#!/usr/bin/env bash
# check-links.sh — scan client/src/, server/, and shared/ for hardcoded external hrefs and verify each resolves with 2xx.
# Excludes test files (*.test.tsx / *.test.ts) and placeholder= attributes.
# Usage: bash scripts/check-links.sh [--timeout SECONDS]
# Exits 0 if all links are reachable, 1 if any return 4xx/5xx or are unreachable.
#
# Timeout configuration:
#   The per-request curl max-time used for both the connectivity probes and the
#   URL checks can be tuned via (in order of precedence):
#     1. --timeout SECONDS   CLI flag
#     2. LINK_CHECK_TIMEOUT  env var
#     3. defaults: 10s for connectivity probes, 15s for URL checks
#   Setting either the flag or the env var overrides BOTH the probe and URL
#   check timeouts with the same value.

set -euo pipefail

LINK_CHECK_TIMEOUT="${LINK_CHECK_TIMEOUT:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: --timeout requires a value (seconds). Usage: --timeout SECONDS" >&2
        exit 1
      fi
      LINK_CHECK_TIMEOUT="$2"
      shift 2
      ;;
    --timeout=*)
      LINK_CHECK_TIMEOUT="${1#--timeout=}"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -n "$LINK_CHECK_TIMEOUT" && ! "$LINK_CHECK_TIMEOUT" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: timeout must be a positive integer >= 1 (seconds), got: $LINK_CHECK_TIMEOUT" >&2
  exit 1
fi

PROBE_TIMEOUT="${LINK_CHECK_TIMEOUT:-10}"
URL_TIMEOUT="${LINK_CHECK_TIMEOUT:-15}"

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
  CONNECTIVITY_CODE=$(curl -sL -o /dev/null -w "%{http_code}" --max-time "$PROBE_TIMEOUT" "$CONNECTIVITY_HOST" 2>/dev/null || echo "000")
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
mapfile -t HREF_URLS < <(
  grep -roh \
    --include="*.tsx" \
    --include="*.ts" \
    --exclude="*.test.tsx" \
    --exclude="*.test.ts" \
    'href="https://[^"]*"' \
    "${SEARCH_DIRS[@]}" \
  | grep -oP 'https://[^"]+'
)

# Also extract bare https:// URLs anywhere else in the source (comments, error
# messages, log output, string literals, etc.), not just href="..." attributes.
# This catches things like `// see https://example.com/docs` or
# `throw new Error("Invalid config, see https://example.com")`.
# - Skips placeholder="https://..." values, same as the href scan (UX hints, not real links).
# - Skips URLs containing template-literal interpolation (e.g. `${docId}`), since
#   those aren't a single resolvable URL.
# - Skips URLs ending in a literal "..." — an illustrative/truncated example, not a real link.
# - Strips a stray trailing escaped newline (`\n`) picked up from template literals.
mapfile -t BARE_URLS < <(
  grep -rhP \
    --include="*.tsx" \
    --include="*.ts" \
    --exclude="*.test.tsx" \
    --exclude="*.test.ts" \
    'https://' \
    "${SEARCH_DIRS[@]}" \
  | grep -v 'placeholder="https://' \
  | grep -oP 'https://[^\s"'"'"'`)>,;]+' \
  | grep -vF '${' \
  | grep -vE '\.\.\.$' \
  | sed -E 's/\\+n$//' \
  | sed -E 's/[.,;:)]+$//'
)

mapfile -t URLS < <(printf '%s\n' "${HREF_URLS[@]}" "${BARE_URLS[@]}" | sed '/^$/d' | sort -u)

DIRS_LABEL="${SEARCH_DIRS[*]}"

if [[ ${#URLS[@]} -eq 0 ]]; then
  echo "No external links found in ${DIRS_LABEL} — nothing to check."
  exit 0
fi

echo "Checking ${#URLS[@]} external link(s) found in ${DIRS_LABEL} ..."
echo ""

for URL in "${URLS[@]}"; do
  CHECKED=$((CHECKED + 1))
  HTTP_CODE=$(curl -sL -o /dev/null -w "%{http_code}" --max-time "$URL_TIMEOUT" --retry 2 --retry-delay 2 "$URL" 2>/dev/null || echo "000")

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
