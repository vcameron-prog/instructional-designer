#!/bin/bash
# build-all.sh
#
# Builds both the main BSU Accessibility Tool and the Instructional Designer
# sub-app so both are ready to run from their respective dist/index.cjs files.
set -euo pipefail

echo ""
echo "============================================================"
echo "  BSU Accessibility Tool — full production build"
echo "============================================================"

echo ""
echo "[build] Step 1: Building main app..."
npm run build

echo ""
echo "[build] Step 2: Building Instructional Designer..."
cd instructional-designer
VITE_API_BASE_PATH=/faculty npx tsx script/build-prod.ts
cd ..

echo ""
echo "============================================================"
echo "  All builds complete."
echo "============================================================"
echo ""
