# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: oidc-state-roundtrip.spec.ts >> OIDC signed-state round-trip smoke tests >> /api/callback with no state param falls back to the root page
- Location: e2e/oidc-state-roundtrip.spec.ts:164:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5000/api/callback?_test_state_only=1
Call log:
  - navigating to "http://127.0.0.1:5000/api/callback?_test_state_only=1", waiting until "networkidle"

```

# Test source

```ts
  67  |   const externalPattern = /^https?:\/\/(?!127\.0\.0\.1|localhost)/;
  68  | 
  69  |   // Abort all external requests (prevents live OIDC connection).
  70  |   await page.route(externalPattern, async (route) => {
  71  |     await route.abort();
  72  |   });
  73  | 
  74  |   // page.on('request', ...) fires synchronously for every request, including
  75  |   // the redirect the browser follows after the server returns 302.  This
  76  |   // captures the URL before the route abort clears it.
  77  |   const requestListener = (request: import("@playwright/test").Request) => {
  78  |     const url = request.url();
  79  |     if (externalPattern.test(url)) {
  80  |       try {
  81  |         const s = new URL(url).searchParams.get("state");
  82  |         if (s) capturedState = s;
  83  |       } catch {
  84  |         // Not a valid URL — ignore.
  85  |       }
  86  |     }
  87  |   };
  88  | 
  89  |   page.on("request", requestListener);
  90  | 
  91  |   try {
  92  |     await page.goto(
  93  |       `${ROOT}/api/login?returnTo=${encodeURIComponent(returnTo)}`,
  94  |       { waitUntil: "commit", timeout: 15_000 }
  95  |     );
  96  |   } catch {
  97  |     // Navigation abort is expected when the OIDC redirect is intercepted.
  98  |   }
  99  | 
  100 |   // Allow in-flight route callbacks to settle.
  101 |   await page.waitForTimeout(300);
  102 | 
  103 |   page.off("request", requestListener);
  104 |   await page.unroute(externalPattern);
  105 | 
  106 |   return capturedState;
  107 | }
  108 | 
  109 | // ---------------------------------------------------------------------------
  110 | // Test suite
  111 | // ---------------------------------------------------------------------------
  112 | 
  113 | test.describe("OIDC signed-state round-trip smoke tests", () => {
  114 |   test(
  115 |     "state param is present in the OIDC authorization URL when returnTo is supplied",
  116 |     async ({ page }) => {
  117 |       const capturedState = await captureStateFromLoginRoute(page, "/faculty");
  118 | 
  119 |       expect(
  120 |         capturedState,
  121 |         "OIDC authorization URL must include a non-empty state param when " +
  122 |           "returnTo is supplied to /api/login"
  123 |       ).toBeTruthy();
  124 | 
  125 |       // The signed state must have the format: <base64url-payload>.<base64url-sig>
  126 |       // (base64url uses "-" and "_" not "+" and "=").
  127 |       expect(
  128 |         capturedState,
  129 |         "state param must match the signed-token shape <data>.<sig>"
  130 |       ).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  131 |     }
  132 |   );
  133 | 
  134 |   test(
  135 |     "signed state from the OIDC authorization URL lands on the correct page after /api/callback",
  136 |     async ({ page }) => {
  137 |       const returnTo = "/faculty";
  138 |       const capturedState = await captureStateFromLoginRoute(page, returnTo);
  139 | 
  140 |       expect(
  141 |         capturedState,
  142 |         "state must have been captured from the OIDC authorization redirect"
  143 |       ).toBeTruthy();
  144 | 
  145 |       // Replay the captured state through the REAL /api/callback endpoint
  146 |       // using the dev/test bypass (_test_state_only=1).  This exercises the
  147 |       // same verifyReturnToState() + redirect logic that production uses after
  148 |       // passport.authenticate() succeeds — without requiring a live OIDC
  149 |       // token exchange.  A real Replit OIDC provider echoes the state param
  150 |       // back in this exact way.
  151 |       await page.goto(
  152 |         `${ROOT}/api/callback?state=${encodeURIComponent(capturedState!)}&_test_state_only=1`,
  153 |         { waitUntil: "networkidle", timeout: 15_000 }
  154 |       );
  155 | 
  156 |       // The browser must land on the returnTo destination.
  157 |       await expect(
  158 |         page,
  159 |         "browser must land on the returnTo destination when /api/callback receives the echoed state"
  160 |       ).toHaveURL(/\/faculty/, { timeout: 10_000 });
  161 |     }
  162 |   );
  163 | 
  164 |   test(
  165 |     "/api/callback with no state param falls back to the root page",
  166 |     async ({ page }) => {
> 167 |       await page.goto(`${ROOT}/api/callback?_test_state_only=1`, {
      |                  ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5000/api/callback?_test_state_only=1
  168 |         waitUntil: "networkidle",
  169 |         timeout: 15_000,
  170 |       });
  171 | 
  172 |       await expect(
  173 |         page,
  174 |         "missing state param must produce a redirect to '/'"
  175 |       ).toHaveURL(/^http:\/\/127\.0\.0\.1:5000\/?$/, { timeout: 10_000 });
  176 |     }
  177 |   );
  178 | 
  179 |   test(
  180 |     "/api/callback with a tampered state param falls back to the root page",
  181 |     async ({ page }) => {
  182 |       const tamperedState = "tampered-payload.invalidsignature";
  183 | 
  184 |       await page.goto(
  185 |         `${ROOT}/api/callback?state=${encodeURIComponent(tamperedState)}&_test_state_only=1`,
  186 |         { waitUntil: "networkidle", timeout: 15_000 }
  187 |       );
  188 | 
  189 |       await expect(
  190 |         page,
  191 |         "tampered state must be rejected and the browser must redirect to '/'"
  192 |       ).toHaveURL(/^http:\/\/127\.0\.0\.1:5000\/?$/, { timeout: 10_000 });
  193 |     }
  194 |   );
  195 | 
  196 |   test(
  197 |     "state param from /api/login without a returnTo is absent or not our signed format",
  198 |     async ({ page }) => {
  199 |       let capturedState: string | null = null;
  200 |       const externalPattern = /^https?:\/\/(?!127\.0\.0\.1|localhost)/;
  201 | 
  202 |       await page.route(externalPattern, async (route) => {
  203 |         await route.abort();
  204 |       });
  205 | 
  206 |       const requestListener = (request: import("@playwright/test").Request) => {
  207 |         const url = request.url();
  208 |         if (externalPattern.test(url)) {
  209 |           try {
  210 |             const s = new URL(url).searchParams.get("state");
  211 |             if (s) capturedState = s;
  212 |           } catch {}
  213 |         }
  214 |       };
  215 |       page.on("request", requestListener);
  216 | 
  217 |       try {
  218 |         await page.goto(`${ROOT}/api/login`, {
  219 |           waitUntil: "commit",
  220 |           timeout: 15_000,
  221 |         });
  222 |       } catch {}
  223 | 
  224 |       await page.waitForTimeout(300);
  225 |       page.off("request", requestListener);
  226 |       await page.unroute(externalPattern);
  227 | 
  228 |       // When no returnTo is given, signedReturnToState is not set, so
  229 |       // ReturnToAwareStrategy does not inject our custom `state` param.
  230 |       // If the OIDC provider sends any state, it is the library's own value,
  231 |       // not our signed v1 token.
  232 |       if (capturedState !== null) {
  233 |         const dotIdx = capturedState.lastIndexOf(".");
  234 |         if (dotIdx !== -1) {
  235 |           try {
  236 |             const decoded = JSON.parse(
  237 |               Buffer.from(capturedState.slice(0, dotIdx), "base64url").toString(
  238 |                 "utf8"
  239 |               )
  240 |             );
  241 |             expect(
  242 |               decoded?.v,
  243 |               "state without returnTo must not carry our v1 signed-state version tag"
  244 |             ).not.toBe("v1");
  245 |           } catch {
  246 |             // Not JSON — definitely not our token. Test passes.
  247 |           }
  248 |         }
  249 |         // No dot separator → not our <payload>.<sig> format → test passes.
  250 |       }
  251 |       // capturedState === null also passes: no state was injected.
  252 |     }
  253 |   );
  254 | });
  255 | 
```