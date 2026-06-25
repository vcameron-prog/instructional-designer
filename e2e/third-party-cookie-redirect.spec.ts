/**
 * E2E test: sign-in redirect survives third-party cookie blocking.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * When a browser blocks third-party cookies (e.g. Chrome with third-party
 * cookies disabled, Safari ITP, Firefox ETP), the session cookie set by
 * /api/login is NOT sent on the OIDC callback request.  The callback comes
 * from a redirect chain that originates at the external OIDC provider, which
 * the browser treats as a cross-site context.
 *
 * The signed-state mechanism encodes the returnTo path into the OIDC `state`
 * query parameter so that the callback handler can read it from the URL
 * without touching the session.  This test proves that mechanism works
 * end-to-end even when no session cookie is available on the callback leg.
 *
 * HOW IT WORKS
 * ------------
 * 1. GET /api/test/sign-state?returnTo=<path>
 *    A test-only server endpoint (disabled in production) calls the same
 *    signing logic as signReturnToState() in replitAuth.ts and returns the
 *    signed token.  The test never needs to know SESSION_SECRET, and the
 *    token is indistinguishable from one produced by a real /api/login call.
 *
 * 2. Clear all browser cookies.
 *    This simulates the session cookie being unavailable on the callback leg
 *    (as happens with third-party cookie blocking or SameSite=Lax in a
 *    cross-site redirect chain).  The server has no session to fall back to.
 *
 * 3. GET /api/callback?state=<signed>&_test_state_only=1
 *    The dev/test bypass in /api/callback skips the OIDC token exchange but
 *    runs the same verifyReturnToState() + redirect logic as production.
 *    No session cookie is present, so if the redirect were driven by
 *    req.session.returnTo it would land on "/" — but the signed state in the
 *    URL must win and deliver the correct deep-link.
 *
 * 4. Assert the browser lands on the originally requested path, not "/".
 *    A redirect to "/" would indicate the signed-state mechanism failed and
 *    the user lost their deep-link destination.
 *
 * Requirements
 * ------------
 * The server must be started with PLAYWRIGHT_TEST=1 (handled by playwright.config.ts).
 * Both the _test_state_only bypass in /api/callback and the /api/test/sign-state
 * endpoint are disabled in production (NODE_ENV !== "production" guard).
 *
 * Run with:
 *   npx playwright test e2e/third-party-cookie-redirect.spec.ts
 */

import { test, expect } from "@playwright/test";

const ROOT = "http://127.0.0.1:5000";

test.describe("sign-in redirect survives third-party cookie blocking", () => {
  test(
    "signed state token delivers the correct deep-link when no session cookie is present",
    async ({ page }) => {
      const returnTo = "/faculty";

      // Step 1 — Obtain a freshly-signed state token from the test-only
      // server endpoint.  The server builds it with the real SESSION_SECRET so
      // this test never has to know the secret itself.  The token is identical
      // in format to one produced by signReturnToState() during a real login.
      const tokenResp = await page.request.get(
        `${ROOT}/api/test/sign-state?returnTo=${encodeURIComponent(returnTo)}`
      );
      expect(
        tokenResp.ok(),
        "GET /api/test/sign-state must return 200 — " +
          "is the server running with PLAYWRIGHT_TEST=1?"
      ).toBe(true);
      const { state: signedState } = await tokenResp.json();
      expect(
        typeof signedState,
        "response body must contain a `state` string"
      ).toBe("string");
      expect(
        signedState,
        "signed state must have the <base64url-data>.<base64url-sig> format"
      ).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

      // Step 2 — Clear all browser cookies to simulate third-party cookie
      // blocking.  After this point the browser has no session cookie, so the
      // server cannot read req.session.returnTo on the callback request.
      await page.context().clearCookies();

      // Step 3 — Navigate to /api/callback with the signed state, mimicking
      // what the OIDC provider does when it echoes the state param back in the
      // redirect URL.  _test_state_only=1 skips the real token exchange while
      // still running the full verifyReturnToState() + redirect logic.
      await page.goto(
        `${ROOT}/api/callback?state=${encodeURIComponent(signedState)}&_test_state_only=1`,
        { waitUntil: "networkidle", timeout: 15_000 }
      );

      // Step 4 — The browser must land on returnTo, not "/".  A redirect to
      // "/" would mean the server fell back to the session (which is empty
      // here) instead of reading the signed state from the URL.
      await expect(
        page,
        "browser must land on the returnTo destination encoded in the signed state, " +
          "even when no session cookie was sent on the callback request"
      ).toHaveURL(new RegExp(returnTo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), {
        timeout: 10_000,
      });
    }
  );

  test(
    "signed state with a deep path including a query string lands on the correct URL",
    async ({ page }) => {
      const returnTo = "/help?tab=account";

      const tokenResp = await page.request.get(
        `${ROOT}/api/test/sign-state?returnTo=${encodeURIComponent(returnTo)}`
      );
      expect(tokenResp.ok()).toBe(true);
      const { state: signedState } = await tokenResp.json();
      expect(typeof signedState).toBe("string");

      await page.context().clearCookies();

      await page.goto(
        `${ROOT}/api/callback?state=${encodeURIComponent(signedState)}&_test_state_only=1`,
        { waitUntil: "networkidle", timeout: 15_000 }
      );

      const finalUrl = new URL(page.url());
      expect(
        finalUrl.pathname,
        "pathname must be /help"
      ).toBe("/help");
      expect(
        finalUrl.searchParams.get("tab"),
        "query string param 'tab' must be preserved"
      ).toBe("account");
    }
  );

  test(
    "no session cookie AND no state param causes fallback to root page",
    async ({ page }) => {
      // Simulate a cookie-blocked callback with no state at all — the server
      // has nothing to go on and must fall back to "/".
      await page.context().clearCookies();

      await page.goto(`${ROOT}/api/callback?_test_state_only=1`, {
        waitUntil: "networkidle",
        timeout: 15_000,
      });

      await expect(
        page,
        "missing state and missing session must produce a redirect to '/'"
      ).toHaveURL(/^http:\/\/127\.0\.0\.1:5000\/?$/, { timeout: 10_000 });
    }
  );

  test(
    "tampered state with no session cookie falls back to root page",
    async ({ page }) => {
      // A tampered token must be rejected even when there is no session to
      // fall back to — proving the HMAC check runs before any redirect.
      const tamperedState = "tampered-payload.invalidsignature";

      await page.context().clearCookies();

      await page.goto(
        `${ROOT}/api/callback?state=${encodeURIComponent(tamperedState)}&_test_state_only=1`,
        { waitUntil: "networkidle", timeout: 15_000 }
      );

      await expect(
        page,
        "tampered state with no session must redirect to '/'"
      ).toHaveURL(/^http:\/\/127\.0\.0\.1:5000\/?$/, { timeout: 10_000 });
    }
  );
});
