#!/bin/bash
set -e
npm install --prefer-offline
npx drizzle-kit migrate
bash scripts/check-schema-drift.sh
