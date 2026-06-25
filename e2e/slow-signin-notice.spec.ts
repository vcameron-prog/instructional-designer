/**
 * E2E test: slow sign-in notice end-to-end.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * The `?signin=slow` query param is appended server-side when an expired
 * (but HMAC-valid) state token is detected in /api/callback.  The
 * SlowSignInNotice component in App.tsx reads the param, strips it via
 * window.history.replaceState, and fires a toast.
 *
 * Unit/integration tests in returnTo.test.ts cover the server redirect logic,
 * but no test exercised the full round-trip from server redirect → client URL
 * → toast → URL cleanup.  This Playwright test closes that gap.
 *
 * HOW IT WORKS
 * ------------
 * 1. GET /api/test/expired-signed-state?returnTo=/
 *    A test-only server endpoint (disabled in production) generates a signed
 *    state token whose timestamp is 15 minutes in the past — beyond the
 *    10-minute TTL — so verifyReturnToState() returns { expired: true }.
 *    The test never needs to know SESSION_SECRET.
 *
 * 2. GET /api/callback?state=<expired>&_test_state_only=1
 *    The dev/test bypass in /api/callback skips the OIDC token exchange but
 *    runs the same verifyReturnToState() + redirect logic as production.
 *    Because the token is expired, the handler appends ?signin=slow to the
 *    redirect destination before issuing the 302.
 *
 * 3. Assert the 302 Location header contains ?signin=slow.
 *
 * 4. Assert the SlowSignInNotice component shows the "Session timed out" toast.
 *
 * 5. Assert the ?signin=slow param has been stripped from the URL.
 *
 * Requirements
 * ------------
 * The server must be started with PLAYWRIGHT_TEST=1 (handled by playwright.config.ts).
 * Both the _test_state_only bypass and the /api/test/expired-signed-state endpoint
 * are disabled in production (NODE_ENV !== "production" guard).
 *
 * Run with:
 *   npx playwright test e2e/slow-signin-notice.spec.ts
 */

import { test, expect } from "@playwright/test";

const ROOT = "http://127.0.0.1:5000";

test.describe("slow sign-in notice", () => {
  test(
    "expired state token causes ?signin=slow redirect, toast appears, then param is stripped",
    async ({ page }) => {
      // Step 1 — Obtain an expired signed state token from the test-only
      // server endpoint.  The server builds it with the real SESSION_SECRET so
      // this test never has to know the secret itself.
      const tokenResp = await page.request.get(
        `${ROOT}/api/test/expired-signed-state?returnTo=/`
      );
      expect(
        tokenResp.ok(),
        "GET /api/test/expired-signed-state must return 200 — " +
          "is the server running with PLAYWRIGHT_TEST=1?"
      ).toBe(true);
      const { state: expiredState } = await tokenResp.json();
      expect(
        typeof expiredState,
        "response body must contain a `state` string"
      ).toBe("string");

      // Step 2 — Listen for the /api/callback response so we can inspect the
      // 302 Location header before the browser follows the redirect.
      let callbackLocation: string | null = null;
      page.on("response", (resp) => {
        if (
          resp.url().includes("/api/callback") &&
          (resp.status() === 302 || resp.status() === 301)
        ) {
          callbackLocation = resp.headers()["location"] ?? null;
        }
      });

      // Step 3 — Navigate to the callback endpoint with the expired state.
      // The _test_state_only=1 flag skips the real OIDC token exchange while
      // still running the redirect logic (verifyReturnToState + signin=slow).
      await page.goto(
        `${ROOT}/api/callback?state=${encodeURIComponent(expiredState)}&_test_state_only=1`,
        { waitUntil: "networkidle", timeout: 15_000 }
      );

      // Step 4 — Assert the redirect URL contained ?signin=slow.
      // This verifies the server-side logic (replitAuth.ts callback handler).
      expect(
        callbackLocation,
        "server must append ?signin=slow to the redirect URL when the state token is expired"
      ).toMatch(/signin=slow/);

      // Step 5 — Assert the "Session timed out" toast appeared.
      // This verifies the SlowSignInNotice component detected the param and
      // fired the toast (App.tsx).
      await expect(
        page.getByText("Session timed out", { exact: true }),
        "SlowSignInNotice must show the 'Session timed out' toast title"
      ).toBeVisible({ timeout: 8_000 });

      // Step 6 — Assert ?signin=slow was stripped from the URL.
      // This verifies window.history.replaceState ran after the toast fired.
      await expect(
        page,
        "SlowSignInNotice must remove ?signin=slow from the URL via replaceState"
      ).not.toHaveURL(/signin=slow/, { timeout: 5_000 });
    }
  );

  test(
    "expired state token still shows toast when returnTo targets a protected page",
    async ({ page }) => {
      // This test guards a specific regression: if the returnTo destination
      // requires authentication, useRequireAuth() fires window.location.href
      // (a full-page navigation) inside a useEffect.  If that redirect fires
      // before SlowSignInNotice's own useEffect has a chance to run, the
      // ?signin=slow param is lost and the toast never appears.
      //
      // The _test_state_only=1 bypass creates a real server-side session, so
      // useRequireAuth() resolves to isAuthenticated=true and the redirect is
      // never triggered.  The test verifies that the toast still fires and the
      // param is still stripped even when the landing page is behind a
      // ProtectedRoute.

      // Step 1 — Obtain an expired signed state token whose returnTo path
      // points at /settings, a route with requiresAuth: true in App.tsx.
      const tokenResp = await page.request.get(
        `${ROOT}/api/test/expired-signed-state?returnTo=/settings`
      );
      expect(
        tokenResp.ok(),
        "GET /api/test/expired-signed-state must return 200 — " +
          "is the server running with PLAYWRIGHT_TEST=1?"
      ).toBe(true);
      const { state: expiredState } = await tokenResp.json();
      expect(
        typeof expiredState,
        "response body must contain a `state` string"
      ).toBe("string");

      // Step 2 — Listen for the /api/callback response to capture the
      // 302 Location header before the browser follows the redirect.
      let callbackLocation: string | null = null;
      page.on("response", (resp) => {
        if (
          resp.url().includes("/api/callback") &&
          (resp.status() === 302 || resp.status() === 301)
        ) {
          callbackLocation = resp.headers()["location"] ?? null;
        }
      });

      // Step 3 — Navigate to the callback with the expired state.
      // The _test_state_only=1 flag both creates a synthetic authenticated
      // session AND runs the redirect logic (verifyReturnToState + signin=slow),
      // so the browser lands on /settings?signin=slow as a logged-in user.
      await page.goto(
        `${ROOT}/api/callback?state=${encodeURIComponent(expiredState)}&_test_state_only=1`,
        { waitUntil: "networkidle", timeout: 15_000 }
      );

      // Step 4 — Assert the redirect URL contained ?signin=slow.
      expect(
        callbackLocation,
        "server must append ?signin=slow when the state token is expired"
      ).toMatch(/signin=slow/);

      // Step 5 — Assert the redirect pointed at the protected page.
      expect(
        callbackLocation,
        "redirect target must be /settings (the protected returnTo path)"
      ).toMatch(/\/settings/);

      // Step 6 — Assert the "Session timed out" toast appeared.
      // SlowSignInNotice is rendered outside <Router>, so it mounts and its
      // useEffect fires before ProtectedRoute can issue any auth redirect.
      await expect(
        page.getByText("Session timed out", { exact: true }),
        "SlowSignInNotice must show the 'Session timed out' toast even on a protected page"
      ).toBeVisible({ timeout: 8_000 });

      // Step 7 — Assert ?signin=slow was stripped from the URL.
      await expect(
        page,
        "SlowSignInNotice must remove ?signin=slow from the URL via replaceState"
      ).not.toHaveURL(/signin=slow/, { timeout: 5_000 });
    }
  );
});
