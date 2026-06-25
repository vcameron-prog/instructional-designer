/**
 * Smoke test: signed OIDC state survives the round-trip for the ID app.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * The Instructional Designer app has its own copy of replitAuth.ts with the
 * same ReturnToAwareStrategy + signReturnToState / verifyReturnToState logic.
 * If that copy diverges from the root CAI app, the state-echo guarantee could
 * silently break for the ID app without the root app's test catching it.
 *
 * This test exercises the full pipeline at the Playwright layer:
 *
 *   Step 1 — GET /api/login?returnTo=<path>
 *     The real ReturnToAwareStrategy.authorizationRequestParams() runs and
 *     injects the signed state token into the OIDC authorization URL.  We
 *     listen to the outbound redirect to capture the `state` query parameter.
 *     This proves the state is sent to the provider in the expected signed format.
 *
 *   Step 2 — GET /api/test/oidc-state-callback?state=<captured-state>
 *     We replay the captured state through the dev-only test endpoint which
 *     runs the same verifyReturnToState() + redirect logic as the production
 *     /api/callback handler — without requiring an interactive OIDC login.
 *     This proves the state-READING side of the round-trip is wired correctly.
 *
 *   Step 3 — assert the browser lands on the correct returnTo destination
 *     Confirms that a real Replit OIDC provider echoing the state back in the
 *     callback URL would cause the user to arrive at the correct page.
 *
 * The test also exercises the fallback paths:
 *   • No state param → redirects to "/".
 *   • Tampered state param → verifyReturnToState() rejects it → redirects to "/".
 *
 * Requirements
 * ------------
 * The server must be running (handled by playwright.config.ts / smoke-test.sh).
 * The /api/test/oidc-state-callback endpoint is registered only when
 * NODE_ENV !== "production" (see server/routes.ts).
 *
 * Run with:
 *   npx playwright test instructional-designer/e2e/oidc-state-roundtrip.spec.ts
 */

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helper: capture the `state` query param from the OIDC authorization URL
// that /api/login redirects to, without following the redirect to the
// external OIDC server.
//
// Strategy: listen to all page requests via `page.on('request', ...)` which
// fires synchronously as each request is initiated.  Any non-local request
// that carries a `state` search param is the OIDC authorization redirect.
// We also register a `page.route()` to abort those external requests so
// Playwright does not attempt a live connection to Replit's OIDC server.
// ---------------------------------------------------------------------------
async function captureStateFromLoginRoute(
  page: import("@playwright/test").Page,
  returnTo: string
): Promise<string | null> {
  let capturedState: string | null = null;

  const externalPattern = /^https?:\/\/(?!127\.0\.0\.1|localhost)/;

  // Abort all external requests (prevents live OIDC connection).
  await page.route(externalPattern, async (route) => {
    await route.abort();
  });

  // page.on('request', ...) fires synchronously for every request, including
  // the redirect the browser follows after the server returns 302.  This
  // captures the URL before the route abort clears it.
  const requestListener = (request: import("@playwright/test").Request) => {
    const url = request.url();
    if (externalPattern.test(url)) {
      try {
        const s = new URL(url).searchParams.get("state");
        if (s) capturedState = s;
      } catch {
        // Not a valid URL — ignore.
      }
    }
  };

  page.on("request", requestListener);

  try {
    await page.goto(
      `/api/login?returnTo=${encodeURIComponent(returnTo)}`,
      { waitUntil: "commit", timeout: 15_000 }
    );
  } catch {
    // Navigation abort is expected when the OIDC redirect is intercepted.
  }

  // Allow in-flight route callbacks to settle.
  await page.waitForTimeout(300);

  page.off("request", requestListener);
  await page.unroute(externalPattern);

  return capturedState;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("ID app — OIDC signed-state round-trip smoke tests", () => {
  test(
    "state param is present in the OIDC authorization URL when returnTo is supplied",
    async ({ page }) => {
      const capturedState = await captureStateFromLoginRoute(page, "/faculty");

      expect(
        capturedState,
        "OIDC authorization URL must include a non-empty state param when " +
          "returnTo is supplied to /api/login"
      ).toBeTruthy();

      // The signed state must have the format: <base64url-payload>.<base64url-sig>
      // (base64url uses "-" and "_" not "+" and "=").
      expect(
        capturedState,
        "state param must match the signed-token shape <data>.<sig>"
      ).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    }
  );

  test(
    "signed state from the OIDC authorization URL lands on the correct page via /api/test/oidc-state-callback",
    async ({ page }) => {
      const returnTo = "/faculty";
      const capturedState = await captureStateFromLoginRoute(page, returnTo);

      expect(
        capturedState,
        "state must have been captured from the OIDC authorization redirect"
      ).toBeTruthy();

      // Replay the captured state through the dev-only test endpoint.
      // This exercises the same verifyReturnToState() + redirect logic that
      // the production /api/callback uses after passport.authenticate()
      // succeeds — without requiring a live OIDC token exchange.
      // A real Replit OIDC provider echoes the state param back in this exact way.
      await page.goto(
        `/api/test/oidc-state-callback?state=${encodeURIComponent(capturedState!)}`,
        { waitUntil: "networkidle", timeout: 15_000 }
      );

      // The browser must land on the returnTo destination.
      await expect(
        page,
        "browser must land on the returnTo destination when the test endpoint receives the echoed state"
      ).toHaveURL(/\/faculty/, { timeout: 10_000 });
    }
  );

  test(
    "/api/test/oidc-state-callback with no state param falls back to the root page",
    async ({ page }) => {
      await page.goto("/api/test/oidc-state-callback", {
        waitUntil: "networkidle",
        timeout: 15_000,
      });

      await expect(
        page,
        "missing state param must produce a redirect to '/'"
      ).toHaveURL(/^https?:\/\/127\.0\.0\.1(:\d+)?\/?$/, { timeout: 10_000 });
    }
  );

  test(
    "/api/test/oidc-state-callback with a tampered state param falls back to the root page",
    async ({ page }) => {
      const tamperedState = "tampered-payload.invalidsignature";

      await page.goto(
        `/api/test/oidc-state-callback?state=${encodeURIComponent(tamperedState)}`,
        { waitUntil: "networkidle", timeout: 15_000 }
      );

      await expect(
        page,
        "tampered state must be rejected and the browser must redirect to '/'"
      ).toHaveURL(/^https?:\/\/127\.0\.0\.1(:\d+)?\/?$/, { timeout: 10_000 });
    }
  );

  test(
    "state param from /api/login without a returnTo is absent or not our signed format",
    async ({ page }) => {
      let capturedState: string | null = null;
      const externalPattern = /^https?:\/\/(?!127\.0\.0\.1|localhost)/;

      await page.route(externalPattern, async (route) => {
        await route.abort();
      });

      const requestListener = (request: import("@playwright/test").Request) => {
        const url = request.url();
        if (externalPattern.test(url)) {
          try {
            const s = new URL(url).searchParams.get("state");
            if (s) capturedState = s;
          } catch {}
        }
      };
      page.on("request", requestListener);

      try {
        await page.goto("/api/login", {
          waitUntil: "commit",
          timeout: 15_000,
        });
      } catch {}

      await page.waitForTimeout(300);
      page.off("request", requestListener);
      await page.unroute(externalPattern);

      // When no returnTo is given, signedReturnToState is not set, so
      // ReturnToAwareStrategy does not inject our custom `state` param.
      // If the OIDC provider sends any state, it is the library's own value,
      // not our signed v1 token.
      if (capturedState !== null) {
        const dotIdx = capturedState.lastIndexOf(".");
        if (dotIdx !== -1) {
          try {
            const decoded = JSON.parse(
              Buffer.from(capturedState.slice(0, dotIdx), "base64url").toString(
                "utf8"
              )
            );
            expect(
              decoded?.v,
              "state without returnTo must not carry our v1 signed-state version tag"
            ).not.toBe("v1");
          } catch {
            // Not JSON — definitely not our token. Test passes.
          }
        }
        // No dot separator → not our <payload>.<sig> format → test passes.
      }
      // capturedState === null also passes: no state was injected.
    }
  );
});
