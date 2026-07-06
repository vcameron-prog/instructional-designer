---
name: Standalone smoke-test scripts assume caller's cwd
description: shell scripts that spawn a dev server + run playwright via relative paths (npm run dev, e2e/*.spec.ts, playwright.config.ts) silently run against the wrong app if invoked from the wrong working directory.
---

A script like `instructional-designer/script/smoke-test.sh` that does `npm run dev &`
and `npx playwright test e2e/foo.spec.ts --config playwright.config.ts` using relative
paths assumes it is invoked with cwd already inside `instructional-designer/`. If a
workflow/validation command runs it as `bash instructional-designer/script/smoke-test.sh`
from the repo root instead, all those relative paths resolve against the ROOT app
instead: `npm run dev` starts the root server, and `e2e/foo.spec.ts` / root's own
`playwright.config.ts` get used. If the root app happens to have a same-named or
similarly-structured e2e file (e.g. both apps have an `oidc-state-roundtrip.spec.ts`
with the same test count), the run silently "passes" against the wrong app with no
error — it looks like success but exercises none of the intended code.

**Why:** Discovered when a new `playwright-id-smoke` validation workflow reported
only 5 passing tests (matching root's oidc-roundtrip file) instead of the expected 30,
with no fatal error, because the workflow command didn't `cd` into the nested app
directory first.

**How to apply:** Always prefix such validation/workflow commands with
`cd instructional-designer && ...` (matching the pattern already used by
`unit-tests-instructional-designer` and the `Instructional Designer` workflow) rather
than passing the script's path from the repo root. When a "passing" test count looks
suspiciously low or matches an unrelated file's test count, check which app's dev
server/config actually got picked up before trusting the green result.
