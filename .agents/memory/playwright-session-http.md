---
name: Playwright session cookie over HTTP
description: How to reliably create an authenticated express-session for Playwright E2E tests running against a local HTTP server.
---

## The rule

When implementing a test-only login endpoint for Playwright, do NOT use `req.login()` (Passport). Write directly to `req.session.passport` and call `req.session.save()` explicitly.

```ts
(req.session as any).passport = { user: sessionUser };
req.session.save((err) => {
  if (err) { res.status(500).json({ error: String(err) }); return; }
  res.json({ ok: true, sessionId: req.sessionID });
});
```

Also set `secure: false` on the session cookie when running in test mode:

```ts
// replitAuth.ts
cookie: {
  httpOnly: true,
  secure: process.env.PLAYWRIGHT_TEST !== "1",
  sameSite: "lax",
  maxAge: sessionTtl,
},
```

**Why:** `req.login()` does not emit a `Set-Cookie` header over HTTP when `secure: true` is set, even with `trust proxy: 1`. With `secure: true` the cookie is only delivered over HTTPS. The direct-write approach bypasses this and triggers `Set-Cookie` unconditionally once the session is saved.

**How to apply:** Any time a Playwright E2E test needs an authenticated session against the local dev server (`http://localhost:5000`), use this pattern in the `PLAYWRIGHT_TEST=1`-gated test endpoint.
