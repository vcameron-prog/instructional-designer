/**
 * End-to-end test: sign-in returnTo redirect works in a real browser flow.
 *
 * This spec proves two things:
 *
 * A. Client-side URL construction: the header Sign In button builds the
 *    returnTo param from `window.location.pathname + window.location.search`
 *    (the same formula used by the queryClient 401 handler).
 *
 * B. Server-side redirect: POST /api/test/login with a `returnTo` body field
 *    creates a real session and issues a 302 redirect back to the original path.
 *    The browser follows that redirect naturally via a form submission — no
 *    manual `page.goto()` call drives the final navigation.  This mirrors what
 *    the real OIDC callback does with req.session.returnTo after a successful
 *    login.
 *
 * Uses /help as the target page because it renders HeaderControls directly
 * (with showLogin defaulting to true), so button-header-login is visible to
 * unauthenticated visitors. Pages using ConverterHeader (history, conversion,
 * upload) force showLogin={false} and do not show this button.
 * /settings was previously tried but it is a protected route (requiresAuth:
 * true) that redirects unauthenticated visitors to OIDC before rendering.
 *
 * Run with:
 *   PLAYWRIGHT_TEST=1 npx playwright test e2e/sign-in-redirect.spec.ts
 */

import { test, expect } from "@playwright/test";
import { loginAndRedirect, DEFAULT_TEST_USER } from "./helpers/auth";

/** Synthetic user used throughout the spec. */
const TEST_USER = {
  ...DEFAULT_TEST_USER,
  sub: "pw-return-to-test-user",
  email: "pwreturnto@bridgew.edu",
  firstName: "Playwright",
  lastName: "ReturnTo",
};

test.describe("Sign-in returnTo redirect flow", () => {
  test.beforeEach(async ({ page }) => {
    // Start each test without an active session.
    await page.context().clearCookies();
  });

  test("unauthenticated visit to a page with HeaderControls shows Sign In button", async ({
    page,
  }) => {
    // /help uses HeaderControls directly with showLogin defaulting to true.
    await page.goto("/help");

    const loginBtn = page.getByTestId("button-header-login");
    await expect(loginBtn).toBeVisible({ timeout: 15_000 });
    await expect(loginBtn).toContainText("Sign In");
  });

  test("Sign In button encodes current path as returnTo query param", async ({
    page,
  }) => {
    const protectedPath = "/help";
    await page.goto(protectedPath);

    const loginBtn = page.getByTestId("button-header-login");
    await expect(loginBtn).toBeVisible({ timeout: 15_000 });

    // Intercept the /api/login navigation to capture the URL it builds, then
    // abort so we stay on the page for inspection.
    const loginRequestPromise = page.waitForRequest("**/api/login*");
    await page.route("**/api/login*", (route) => route.abort());

    await loginBtn.click();

    const loginRequest = await loginRequestPromise;
    const loginUrl = new URL(loginRequest.url());
    const returnTo = loginUrl.searchParams.get("returnTo");

    // The returnTo must match the path the user was on when they clicked Sign In.
    expect(returnTo).toBe(protectedPath);
  });

  test("after sign-in the browser lands on the originally requested URL, not just /", async ({
    page,
  }) => {
    const protectedPath = "/help";

    // Step 1: Navigate to the page without being signed in.
    await page.goto(protectedPath);

    // Step 2: Assert the sign-in prompt is shown and verify the formula it uses.
    const loginBtn = page.getByTestId("button-header-login");
    await expect(loginBtn).toBeVisible({ timeout: 15_000 });

    // Read the returnTo formula directly from the browser — the same expression
    // used by the Sign In button's onClick and the queryClient 401 handler.
    const capturedReturnTo = await page.evaluate(
      () => window.location.pathname + window.location.search,
    );
    expect(capturedReturnTo).toBe(protectedPath);

    // Step 3: Simulate the post-OIDC callback using the shared loginAndRedirect
    // helper, which POSTs to /api/test/login with returnTo in the body.
    // The endpoint creates a real session and issues a 302 redirect — the
    // browser follows that redirect naturally.
    await loginAndRedirect(page, capturedReturnTo, TEST_USER);

    // Step 4: Assert the browser is on the correct URL — not just "/".
    expect(new URL(page.url()).pathname).toBe(protectedPath);

    // The header Sign In button must be gone — we're authenticated now.
    await expect(page.getByTestId("button-header-login")).not.toBeVisible({
      timeout: 10_000,
    });

    // The page must render content that proves we're on /help.
    await expect(page.getByText("Help & Resources")).toBeVisible({ timeout: 10_000 });
  });

  test("returnTo preserves path AND query string (matches queryClient 401 handler)", async ({
    page,
  }) => {
    // The queryClient 401 handler uses:
    //   window.location.pathname + window.location.search
    // This test verifies the header Sign In button uses the same formula by
    // navigating to a path with a query string and checking the encoded value.
    const pathWithSearch = "/help?tab=account";
    await page.goto(pathWithSearch);

    const loginBtn = page.getByTestId("button-header-login");
    await expect(loginBtn).toBeVisible({ timeout: 15_000 });

    const loginRequestPromise = page.waitForRequest("**/api/login*");
    await page.route("**/api/login*", (route) => route.abort());

    await loginBtn.click();

    const loginRequest = await loginRequestPromise;
    const loginUrl = new URL(loginRequest.url());
    const returnTo = loginUrl.searchParams.get("returnTo");

    // returnTo must include both pathname AND search params.
    expect(returnTo).toBe(pathWithSearch);
  });
});
