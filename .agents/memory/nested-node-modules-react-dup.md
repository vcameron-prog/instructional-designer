---
name: Nested npm install causes duplicate React instances
description: Running npm install inside a sub-app directory that shares root test tooling can create a nested node_modules/react copy, breaking hook calls in vitest.
---

## Rule
If a sub-app lives in a subdirectory (e.g. `instructional-designer/`) and shares the root's `vitest`/`@testing-library/react` installation (i.e. the sub-app has no local copies of those test tools), do NOT `npm install` a new package from inside that subdirectory without checking whether it silently creates a local `node_modules/react` + `react-dom`. Node's module resolution will then pick the nested copy for some imports and the root copy for others, producing a "duplicate React instances" bug that manifests as "Invalid hook call" errors in tests that render components with hooks — even though the component code itself is correct.

**Why:** `npm install <pkg>` in a subdirectory without a lockfile boundary can hoist/duplicate transitive deps like `react`/`react-dom` locally instead of reusing the parent's. Vitest + Testing Library resolve React relative to each importing module's location, so mismatched instances break `useState`/`useEffect` etc. with cryptic hook-call errors unrelated to the actual component logic.

**How to apply:** After installing any package inside a sub-app directory, check for accidentally-created `node_modules/react`, `react-dom`, `@types/react`, `@types/react-dom` inside that sub-app and remove them (`rm -rf`) if the parent/root already provides those and the sub-app isn't meant to have independent versions. Re-run affected component tests to confirm the fix.
