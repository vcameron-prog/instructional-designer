#!/bin/sh
# Start the instructional-designer dev server with the correct env vars.
# Used by playwright.config.ts webServer so the command works even when the
# runner shell cannot execute inline env-var assignments.
PORT="${ID_PORT:-3001}" PLAYWRIGHT_TEST=1 npm run dev
