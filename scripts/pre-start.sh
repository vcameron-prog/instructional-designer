#!/bin/bash
# pre-start.sh
#
# Production pre-start gate.  Runs before the server process so a deploy with
# missing migrations fails clean rather than crashing a live server.
#
# Steps:
#   1. Apply any pending Drizzle migrations (npm run db:migrate).
#   2. Assert zero pending migrations remain (scripts/assert-migrations-applied.ts).
#   3. Launch the production server.
#
# If either step 1 or step 2 exits non-zero this script exits immediately (set
# -e) and the server is never started.
set -euo pipefail

echo ""
echo "============================================================"
echo "  BSU Accessibility Tool — production pre-start"
echo "============================================================"

echo ""
echo "[pre-start] Step 1: Recovering any out-of-band migration journal gaps..."
npx tsx scripts/recover-migration-journal.ts

echo ""
echo "[pre-start] Step 2: Applying database migrations..."
npm run db:migrate

echo ""
echo "[pre-start] Step 3: Asserting zero pending migrations..."
npx tsx scripts/assert-migrations-applied.ts

echo ""
echo "[pre-start] All checks passed."

echo ""
echo "[pre-start] Step 4: Starting Instructional Designer server (background)..."
PORT=3001 node instructional-designer/dist/index.cjs &
ID_PID=$!
echo "[pre-start] Instructional Designer started (PID $ID_PID)"

echo ""
echo "[pre-start] Step 4b: Waiting for Instructional Designer to bind on port 3001..."
for i in $(seq 1 30); do
  if nc -z 127.0.0.1 3001 2>/dev/null; then
    echo "[pre-start] Instructional Designer is ready on port 3001 (${i}s)"
    break
  fi
  if ! kill -0 "$ID_PID" 2>/dev/null; then
    echo "[pre-start] ERROR: Instructional Designer process exited before binding to port 3001" >&2
    exit 1
  fi
  sleep 1
done

echo ""
echo "[pre-start] Step 5: Starting main server..."
echo "============================================================"
echo ""

exec node dist/index.cjs
