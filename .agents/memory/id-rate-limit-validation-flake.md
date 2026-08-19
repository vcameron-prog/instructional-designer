---
name: Instructional Designer DB-backed rate limit fails validation runs
description: Repeated smoke-test/validation runs hit the persistent ai-gen rate limit, causing unrelated 429 failures.
---
The instructional-designer app's rate limiter is DB-backed (rate_limit_log table, 10 "ai-gen" requests per IP per hour), so it persists across server restarts. Repeated playwright-id-smoke validation runs within an hour accumulate entries and the SSRF-guard test then gets 429 instead of 400.

**Why:** validation failures here can be pre-existing environmental state, not caused by the change under review.

**How to apply:** if playwright-id-smoke fails with a 429 on a tools endpoint, clear stale rows with: psql "$DATABASE_URL" -c "DELETE FROM rate_limit_log WHERE action = 'ai-gen';" and re-run validation.
