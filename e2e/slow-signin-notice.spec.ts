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

  test(
    "toast fires before useRequireAuth redirect when session is missing on a protected page",
    async ({ page }) => {
      // EDGE CASE: expired or invalidated session cookie
      // --------------------------------------------------------------------------
      // This test covers the third scenario not addressed by the two tests above:
      // the browser arrives on a protected page with ?signin=slow while holding
      // NO valid session (cookie absent, expired server-side, or invalidated).
      //
      // Expected product behavior:
      //   1. SlowSignInNotice's useEffect fires immediately on mount. It reads
      //      window.location.search synchronously — no network call — strips the
      //      ?signin=slow param, and fires the "Session timed out" toast.
      //   2. useRequireAuth() also fires a useEffect. However it can only redirect
      //      after its auth query (GET /api/auth/user) completes and returns 401,
      //      which requires a full HTTP round-trip.
      //   3. Because step 1 is synchronous and step 2 is async, the toast is
      //      guaranteed to render before the redirect fires under normal conditions.
      //   4. After the toast appears the page is redirected to /api/login so the
      //      user can sign in again. The toast serves as a brief notice that their
      //      session timed out before they are asked to authenticate.
      //
      // We simulate "expired/invalid session" by navigating directly to the
      // protected page with ?signin=slow and no auth cookie — identical to what
      // the browser sees if the session was cleared between the OAuth redirect
      // and landing back on the returnTo page.
      // --------------------------------------------------------------------------

      // Navigate to a protected page with ?signin=slow but NO auth session.
      // Using waitUntil:"domcontentloaded" so Playwright returns as soon as the
      // initial HTML is parsed, before the JS-driven redirect fires.
      await page.goto(`${ROOT}/settings?signin=slow`, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });

      // The "Session timed out" toast must appear before useRequireAuth redirects.
      // SlowSignInNotice reads the URL synchronously; the auth check requires a
      // network round-trip, so there is a reliable ordering guarantee here.
      await expect(
        page.getByText("Session timed out", { exact: true }),
        "SlowSignInNotice must show the 'Session timed out' toast even when the " +
          "session is missing (expired or invalidated) — the toast fires before " +
          "useRequireAuth() can complete its async auth check and redirect"
      ).toBeVisible({ timeout: 8_000 });

      // Note: we do NOT assert on the final URL here. After the toast appears,
      // useRequireAuth() will redirect to /api/login once the auth query returns
      // 401. Asserting a specific post-redirect URL would be flaky because the
      // timing of that redirect relative to Playwright's observation window varies.
      // The critical invariant — that the toast fires at all — is asserted above.
    }
  );

  test(
    "toast does NOT fire a second time after browser back-navigation to the cleaned URL",
    async ({ page }) => {
      // REGRESSION GUARD: replaceState strips ?signin=slow from the history entry.
      // --------------------------------------------------------------------------
      // When SlowSignInNotice fires it calls window.history.replaceState, which
      // mutates the current history entry in-place so the URL no longer contains
      // ?signin=slow.  If the user presses Back (after being redirected away by
      // useRequireAuth), they land on the already-cleaned URL.  The param is gone,
      // so SlowSignInNotice's useEffect must not fire the toast a second time.
      //
      // Test flow
      // ---------
      // 1. Navigate to /settings?signin=slow with no auth cookie.
      // 2. Assert the toast appears (first and only expected occurrence).
      // 3. Assert the URL is cleaned before the redirect fires.
      // 4. Wait for useRequireAuth() to redirect away (to /api/login).
      // 5. Navigate Back — the browser restores the cleaned /settings URL.
      // 6. Assert the toast does NOT appear again.
      // --------------------------------------------------------------------------

      // Step 1 — Navigate to the protected page with ?signin=slow and no session.
      // domcontentloaded lets us observe the toast before the JS redirect fires.
      await page.goto(`${ROOT}/settings?signin=slow`, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });

      // Step 2 — Assert the "Session timed out" toast appeared exactly once.
      await expect(
        page.getByText("Session timed out", { exact: true }),
        "SlowSignInNotice must show the toast on the first visit"
      ).toBeVisible({ timeout: 8_000 });

      // Step 3 — Assert replaceState already cleaned the URL in this history entry.
      await expect(
        page,
        "replaceState must strip ?signin=slow from the URL before the redirect"
      ).not.toHaveURL(/signin=slow/, { timeout: 5_000 });

      // Step 4 — Wait for useRequireAuth() to redirect away to the login page.
      // The auth query (GET /api/auth/user) must return 401 and then the effect
      // issues window.location.href — a full-page navigation.  We wait for a URL
      // change away from /settings to confirm the redirect has completed.
      await page.waitForURL((url) => !url.pathname.startsWith("/settings"), {
        timeout: 15_000,
      });

      // Step 5 — Navigate Back.  The browser pops the history stack and restores
      // the entry that replaceState cleaned (/settings, without ?signin=slow).
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 });

      // Confirm Back actually landed on /settings and not on an intermediate
      // page (e.g. /api/login) that could make the following negative assertions
      // pass vacuously.  replaceState mutated the entry in-place, so the URL
      // must be /settings.  The separate not.toHaveURL(/signin=slow/) assertion
      // below then confirms the param is still absent.
      await expect(
        page,
        "back-navigation must restore the /settings history entry"
      ).toHaveURL(/\/settings/, { timeout: 5_000 });

      // Step 6 — The toast must NOT fire a second time.
      // We give a short window (3 s) so the test stays fast while still catching
      // any regression where SlowSignInNotice fires on the stale history entry.
      await expect(
        page.getByText("Session timed out", { exact: true }),
        "SlowSignInNotice must NOT show the toast again after back-navigation " +
          "because replaceState already stripped ?signin=slow from the history entry"
      ).not.toBeVisible({ timeout: 3_000 });

      // Step 7 — Confirm the URL is still free of ?signin=slow.
      await expect(
        page,
        "the back-navigated URL must not contain ?signin=slow"
      ).not.toHaveURL(/signin=slow/);
    }
  );
});
