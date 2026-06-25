#!/bin/bash
set -e

# Only run npm install if package.json changed since the last marker file.
# This skips the ~20s install on merges that don't add new packages.
MARKER="/tmp/.post-merge-npm-install-hash"
CURRENT_HASH=$(md5sum package.json package-lock.json 2>/dev/null | md5sum | cut -d' ' -f1)
LAST_HASH=$(cat "$MARKER" 2>/dev/null || echo "")

if [ "$CURRENT_HASH" != "$LAST_HASH" ]; then
  npm install --prefer-offline
  echo "$CURRENT_HASH" > "$MARKER"
else
  echo "package.json/package-lock.json unchanged — skipping npm install"
fi

npm run db:migrate
bash scripts/check-schema-drift.sh

# Verify the DB actually reflects all applied migrations after the migrate step.
# This catches cases where drizzle-kit migrate exits 0 but silently skipped rows.
npx tsx scripts/assert-migrations-applied.ts

# Verify all hardcoded external links in client/src/ resolve successfully.
# A dead link blocks the deployment here rather than reaching users.
echo ""
echo "Checking external links in client/src/ ..."
bash scripts/check-links.sh

