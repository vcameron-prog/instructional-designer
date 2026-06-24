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
echo "[pre-start] All checks passed. Starting server..."
echo "============================================================"
echo ""

exec node dist/index.cjs
