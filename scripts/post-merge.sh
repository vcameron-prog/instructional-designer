#!/bin/bash
set -e
npm install
npx drizzle-kit migrate
bash scripts/check-schema-drift.sh
