---
name: instructional-designer/ split gaps
description: The instructional-designer/ app was manually split out of the root app's server/routes.ts; the split was incomplete and some routes the frontend still depends on were never ported over.
---

When a route referenced by `instructional-designer/client/` returns 404 with no matching handler in `instructional-designer/server/routes.ts`, don't assume it's dead code to delete.

**Why:** The split from the monolithic root `server/routes.ts` (see the commit that introduces `instructional-designer/` as its own workspace) was done by hand, not generated. At least one pair of routes (`/api/content/:id/preview-fix` and `/api/content/:id/fix-accessibility`, plus their helper functions and `lib/table-fixers.ts` / a lean `lib/accessibility-engine.ts`) were used by the frontend (`result.tsx`, `result-batch.tsx`) but never carried over, causing a batch of tests to fail against real 404s.

**How to apply:** Before deleting a route + its tests as "dead code," (1) grep the `instructional-designer/client/src` frontend for the endpoint path to confirm it's actually unused, and (2) check git log/older commits for a pre-split version of `server/routes.ts` in the root app — the original implementation is often still there and can be ported with light adaptation (the ID app already has its own `getUserId`/`getVisitorToken`/rate-limit helpers, so only route-specific logic and pure-function helpers usually need copying). Keep ported lib files lean/self-contained rather than pulling in the full original file if it has heavy unrelated dependencies (e.g. PDF pipeline, appMetrics).
