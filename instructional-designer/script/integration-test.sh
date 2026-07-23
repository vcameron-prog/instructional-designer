#!/bin/sh
# Self-contained tools-integration test runner for the instructional-designer app.
# Starts the dev server, waits for it, runs only tools-integration.spec.ts, then
# tears everything down.
#
# This pattern avoids Playwright's webServer config spawning /bin/sh internally,
# which fails in the validation runner's sandboxed environment (spawn /bin/sh ENOENT).
# See smoke-test.sh for the same pattern applied to the broader smoke suite.

set -e

PORT="${ID_PORT:-3099}"

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

VITE_CONVERTER_APP_URL="${VITE_CONVERTER_APP_URL:-https://bsu-instructional-designer.replit.app/accessibility}"

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

# Server is up — Playwright will reuse it (reuseExistingServer: true).
# color-contrast tests always run; URL-scanner tests skip gracefully when
# ANTHROPIC_API_KEY is absent.
ID_PORT="$PORT" npx playwright test \
  e2e/tools-integration.spec.ts \
  --config playwright.config.ts
