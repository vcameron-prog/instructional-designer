#!/bin/sh
# Self-contained auth-flow e2e test runner.
# Starts the root dev server on an isolated port, waits for it, runs
# e2e/sign-in-redirect.spec.ts, then tears everything down.
#
# This avoids the EADDRINUSE race condition that occurs when the validation
# runner fires playwright-auth at the same moment Start application is
# restarting (port 5000 is briefly unbound, Playwright falls through to
# starting its own server, then the app binds 5000 first — deadlock).

set -e

PORT="${AUTH_TEST_PORT:-5097}"

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

PORT="$PORT" PLAYWRIGHT_TEST=1 npm run dev &
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

AUTH_TEST_PORT="$PORT" PLAYWRIGHT_BASE_URL="http://127.0.0.1:${PORT}" \
  npx playwright test e2e/sign-in-redirect.spec.ts
