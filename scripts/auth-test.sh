~/workspace$ cat scripts/auth-test.sh
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
~/workspace$ cp scripts/auth-test.sh ~/auth-test.sh.backup
~/workspace$ git reset --hard origin/main
HEAD is now at bb26373 Add files via upload
~/workspace$ mkdir -p scripts
~/workspace$ cp ~/auth-test.sh.backup scripts/auth-test.sh
~/workspace$ grep -c "replit.local" package-lock.json
0
~/workspace$ git add scripts/auth-test.sh
~/workspace$ git commit -m "Add auth-test.sh runner script"
[main 1d6defe] Add auth-test.sh runner script
 1 file changed, 41 insertions(+)
 create mode 100644 scripts/auth-test.sh
~/workspace$ git push
remote: Invalid username or token. Password authentication is not supported for Git operations.
fatal: Authentication failed for 'https://github.com/vcameron-prog/instructional-designer.git/'
~/workspace$ 
