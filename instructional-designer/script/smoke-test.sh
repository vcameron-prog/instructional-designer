#!/bin/sh
# Self-contained smoke test runner.
# Starts the instructional-designer dev server, waits for it to be ready,
# runs the Playwright id-smoke tests, then tears everything down.
# This avoids having Playwright's webServer spawn /bin/sh internally,
# which fails in the validation runner's sandboxed environment.

set -e

PORT="${ID_PORT:-3001}"

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# VITE_CONVERTER_APP_URL is required for the converter-link smoke test.
# Use a placeholder URL in test environments where no real converter is deployed.
VITE_CONVERTER_APP_URL="${VITE_CONVERTER_APP_URL:-https://bsu-accessibility-tool.replit.app}"

# Start the dev server in the background from the project root
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

# Run the smoke tests. Server is already running, so Playwright
# will reuse it (reuseExistingServer: true in playwright.config.ts).
npx playwright test e2e/id-smoke.spec.ts --config playwright.config.ts
