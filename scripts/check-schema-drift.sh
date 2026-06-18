#!/bin/bash
# Detects whether the Drizzle schema has changes that haven't been turned into
# a migration file yet.  Exits 1 and prints a clear error if drift is found.
set -e

MIGRATIONS_DIR="./migrations"
META_DIR="$MIGRATIONS_DIR/meta"

# Snapshot the files that exist BEFORE we run generate so we can clean up after.
before_sql=$(find "$MIGRATIONS_DIR" -maxdepth 1 -name "*.sql" | sort)
before_meta=$(find "$META_DIR" -maxdepth 1 -type f | sort)

# Run drizzle-kit generate.  --name avoids the interactive name prompt.
npx drizzle-kit generate --name schema-drift-check > /tmp/drizzle-generate.log 2>&1 || {
  echo "ERROR: drizzle-kit generate failed. Output:"
  cat /tmp/drizzle-generate.log
  exit 1
}

# Compute any newly created files.
after_sql=$(find "$MIGRATIONS_DIR" -maxdepth 1 -name "*.sql" | sort)
after_meta=$(find "$META_DIR" -maxdepth 1 -type f | sort)

new_sql=$(comm -13 <(echo "$before_sql") <(echo "$after_sql"))
new_meta=$(comm -13 <(echo "$before_meta") <(echo "$after_meta"))

if [ -n "$new_sql" ]; then
  echo ""
  echo "============================================================"
  echo "  SCHEMA DRIFT DETECTED"
  echo "============================================================"
  echo "  The following migration file(s) were generated because your"
  echo "  schema changes have not been committed as a migration yet:"
  echo ""
  for f in $new_sql; do
    echo "    $f"
  done
  echo ""
  echo "  To fix this, run:"
  echo "    npx drizzle-kit generate"
  echo "  and commit the resulting migration file(s) before merging."
  echo "============================================================"
  echo ""

  # --- Clean up files created by the drift-detection run ---
  # Remove generated SQL files.
  for f in $new_sql; do
    rm -f "$f"
  done

  # Remove any new meta files (e.g. 0002_snapshot.json).
  for f in $new_meta; do
    rm -f "$f"
  done

  # Restore any meta files that were modified (e.g. _journal.json).
  if git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    git checkout -- "$META_DIR/" > /dev/null 2>&1 || true
  fi

  exit 1
else
  echo "Schema is up to date — no pending migrations detected."
fi
