---
name: Validation runs flake on timeouts/rate limits
description: Known flaky failures in the full markTaskComplete validation suite
---
The full validation run can fail for reasons unrelated to the change: vitest server tests hit hook/test timeouts (10s/5s) under parallel load, and the instructional-designer smoke suite's SSRF-guard test can get a 429 (rate limit consumed by the earlier url-scanner test) instead of 400.
**Why:** Two consecutive validation failures on task work that was client-only; each failing test passed in isolation.
**How to apply:** When validation fails on tests untouched by your change, run the failing file locally; if it passes, retry markTaskComplete instead of "fixing" unrelated tests.
