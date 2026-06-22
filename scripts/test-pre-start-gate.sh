#!/bin/bash
# test-pre-start-gate.sh
#
# Smoke-test for the pre-start migration gate.  Verifies that the gate script
# (scripts/assert-migrations-applied.ts) exits non-zero and emits a clear error
# before the server would be launched in two simulated failure scenarios:
#
#   Test 1 — DATABASE_URL missing: assert must exit 1 immediately.
#   Test 2 — DATABASE_URL invalid: assert must exit 1 (cannot connect to DB).
#
# Running this in CI or before a deploy provides evidence that the gate will
# abort a deploy cleanly rather than letting a misconfigured server start.
#
# Usage:
#   bash scripts/test-pre-start-gate.sh
set -euo pipefail

PASS=0
FAIL=0

run_test() {
  local label="$1"
  shift
  echo ""
  echo "[gate-test] $label"
  if "$@" 2>&1; then
    echo "[gate-test] FAIL — expected non-zero exit but got 0"
    FAIL=$((FAIL + 1))
  else
    echo "[gate-test] PASS — exited non-zero as expected"
    PASS=$((PASS + 1))
  fi
}

echo ""
echo "============================================================"
echo "  Pre-start gate smoke tests"
echo "============================================================"

# Test 1: DATABASE_URL is completely absent — script must reject immediately.
run_test "Test 1: DATABASE_URL missing → gate must abort" \
  env -u DATABASE_URL npx tsx scripts/assert-migrations-applied.ts

# Test 2: DATABASE_URL is set to an invalid connection string — script must
# fail when it tries to connect, not silently pass.
run_test "Test 2: Invalid DATABASE_URL → gate must abort" \
  env DATABASE_URL="postgresql://nobody:bad@localhost:1/nodb" \
  npx tsx scripts/assert-migrations-applied.ts

echo ""
echo "============================================================"
echo "  Results: $PASS passed, $FAIL failed"
echo "============================================================"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "[gate-test] GATE TESTS FAILED — the migration gate is not working correctly."
  exit 1
fi

echo "[gate-test] All gate tests passed."
