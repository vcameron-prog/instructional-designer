#!/bin/bash
set -e
npm install
npm run db:push -- --force
bash scripts/check-schema-drift.sh
