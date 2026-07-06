---
name: Playwright baseURL discards path segments
description: page.goto("/foo") resolves against baseURL's origin only, dropping any path prefix in baseURL — relevant when the app under test is mounted at a sub-path.
---

When a Playwright `baseURL` includes a path segment (e.g. `http://localhost:3001/faculty`),
`page.goto("/foo")` (leading slash) resolves against the **origin** of baseURL only —
the `/faculty` segment is silently discarded. So `page.goto("/foo")` navigates to
`http://localhost:3001/foo`, NOT `http://localhost:3001/faculty/foo`.

**Why:** This is standard URL-resolution behavior (leading `/` means "absolute path from
origin"), but it's easy to assume baseURL's full value is honored. Setting
`PLAYWRIGHT_BASE_URL` to end in a sub-path is NOT enough by itself if the app's own
router (e.g. wouter's `<Router base="/faculty">`) also expects that prefix.

**How to apply:** When an app's client-side router is mounted at a sub-path, add a
helper like `appPath(path) => "/faculty" + path` and use it for every SPA-route
`page.goto()` call. Leave non-SPA dev-only API paths (e.g. `/api/test/login`) as plain
paths if they are not served behind that sub-path prefix.
