#!/bin/sh
# Dedicated smoke test runner for the OIDC signed-state round-trip spec.
# Uses port 3002 so it can run in parallel with smoke-test.sh (port 3001)
# without an EADDRINUSE conflict in the validation runner.

set -e

PORT="${ID_PORT:-3002}"

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

VITE_CONVERTER_APP_URL="${VITE_CONVERTER_APP_URL:-https://bsu-instructional-designer.replit.app/accessibility}"

# Start the dev server in the background from the project root.
PORT="$PORT" PLAYWRIGHT_TEST=1 VITE_CONVERTER_APP_URL="$VITE_CONVERTER_APP_URL" npm run dev &
SERVER_PID=$!

echo "Waiting for server on port $PORT (pid $SERVER_PID)..."
i=0
while [ "$i" -lt 90 ]; do
  if curl -sf "http://127.0.0.1:${PORT}" >/dev/null 2>&1; then
    echo "Server ready after ${i}s"
    break
  fi
  i=$((i + 1))
  if [ "$i" -eq 90 ]; then
    echo "Server did not start within 90 seconds" >&2
    exit 1
  fi
  sleep 1
done

# Run only the OIDC state round-trip spec.
# Server is already running; Playwright reuses it (reuseExistingServer: true).
CI=1 ID_PORT="$PORT" PLAYWRIGHT_BASE_URL="http://127.0.0.1:${PORT}" \
  npx playwright test e2e/oidc-state-roundtrip.spec.ts --config playwright.config.ts
