#!/bin/sh
# Runs the id-smoke Playwright tests after a merge when instructional-designer
# server-side files changed.  Called from post-merge.sh.
#
# Change detection uses ORIG_HEAD..HEAD — the full range introduced by the
# merge/pull.  ORIG_HEAD is read as a git ref (git rev-parse ORIG_HEAD), not
# as a shell environment variable, because git stores it in .git/ORIG_HEAD.
# If the ref cannot be resolved (e.g. first-ever commit, shallow clone, or
# manual invocation) the script fails open and attempts to run the tests.
#
# Post-merge only (fast path): smoke tests only execute when the Instructional
# Designer dev server is already listening on port 3001.  This guarantees the
# hook completes within the post-merge time budget (cold-start can take 90s+).
# When no server is found, a clear notice is printed so the developer knows to
# run the id-smoke validation step manually.  The self-contained cold-start
# path (smoke-test.sh) remains available in the validation runner.
#
# A non-zero exit code is surfaced in the log but does NOT abort post-merge.sh
# (the caller uses "|| true" so schema/migration gates still pass).

PORT="${ID_PORT:-3001}"

run_if_server_up() {
  if curl -sf "http://127.0.0.1:${PORT}" >/dev/null 2>&1; then
    echo "[id-smoke] Server already up on port ${PORT} — running Playwright directly."
    cd instructional-designer
    PLAYWRIGHT_BASE_URL="http://127.0.0.1:${PORT}" \
      npx playwright test e2e/id-smoke.spec.ts --config playwright.config.ts
  else
    echo "[id-smoke] Instructional Designer server is not running on port ${PORT}."
    echo "[id-smoke] Skipping automated run to stay within the post-merge time budget."
    echo "[id-smoke] Run the 'id-smoke' validation step manually to verify your changes."
  fi
}

# Resolve the base commit of this merge using the git ref, not a shell env var.
base=$(git rev-parse --verify ORIG_HEAD 2>/dev/null || true)

if [ -z "$base" ]; then
  echo "[id-smoke] ORIG_HEAD ref not found — cannot determine changed files (fail-open)."
  run_if_server_up
  exit 0
fi

changed_files=$(git diff --name-only "$base" HEAD 2>/dev/null || true)

if [ -z "$changed_files" ]; then
  echo "[id-smoke] git diff returned no output (fail-open)."
  run_if_server_up
  exit 0
fi

server_changed=$(echo "$changed_files" | grep -E "^instructional-designer/(server|shared)/" || true)

if [ -z "$server_changed" ]; then
  echo "[id-smoke] No instructional-designer server/shared files changed — skipping smoke tests."
  exit 0
fi

echo "[id-smoke] Server-related files changed:"
echo "$server_changed" | sed 's/^/  /'
echo "[id-smoke] Running smoke tests..."
run_if_server_up
