---
name: Top-level route calls in routes.ts crash the CJS bundle
description: A route call (app.get/post/etc.) placed outside registerRoutes() — even one line above the imports — causes ReferenceError: app is not defined at module load time, crashing the production bundle silently.
---

## Rule
Every `app.get/post/put/delete/use(...)` call in `server/routes.ts` MUST live inside the `registerRoutes` exported function. Code placed at module top-level runs before `app` is passed in, so `app` is undefined at that point.

**Why:** A task merge accidentally inserted an `app.get("/api/stats/monthly", ...)` block at line 1 of routes.ts (before the imports). esbuild bundles the file as-is; at runtime Node.js evaluates the top-level call first and throws `ReferenceError: app is not defined`, crashing the server before it binds any port.

**How to apply:** Before merging any task that touches `server/routes.ts`, verify the first non-comment, non-import statement in the file is inside `registerRoutes`. The typecheck workflow (`npx tsc --noEmit`) will also catch it as `TS2304: Cannot find name 'app'` at the affected line.

## Also fixed in same session
`server/lib/rtf-extractor.ts` used `createRequire(import.meta.url)`. In esbuild CJS output `import.meta.url` becomes `undefined`, so `createRequire(undefined)` throws `TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string or URL. Received undefined`. Fixed by replacing with `createRequire(__filename)`, which is always a valid string in any Node.js CJS context.
