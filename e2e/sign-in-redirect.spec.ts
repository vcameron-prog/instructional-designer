/**
 * End-to-end test: sign-in returnTo redirect works in a real browser flow.
 *
 * This spec proves two things:
 *
 * A. Client-side URL construction: the header Sign In button builds the
 *    returnTo param from `window.location.pathname + window.location.search`
 *    (the same formula used by the queryClient 401 handler).
 *
 * B. Server-side redirect: GET /api/test/login?returnTo=<path> creates a real
 *    session and issues a 302 redirect back to the original path. The browser
 *    follows that redirect naturally — no manual `page.goto()` call drives the
 *    final navigation.  This mirrors what the real OIDC callback does with
 *    req.session.returnTo after a successful login.
 *
 * Uses /settings as the target page because it renders HeaderControls directly
 * (with showLogin defaulting to true), so button-header-login is visible to
 * unauthenticated visitors. Pages using ConverterHeader (history, conversion,
 * upload) force showLogin={false} and do not show this button.
 *
 * Run with:
 *   PLAYWRIGHT_TEST=1 npx playwright test e2e/sign-in-redirect.spec.ts
 */

import { test, expect } from "@playwright/test";

/** Synthetic user used throughout the spec. */
const TEST_USER = {
  sub: "pw-return-to-test-user",
  email: "pwreturnto@bridgew.edu",
  firstName: "Playwright",
  lastName: "ReturnTo",
};

/** Build an absolute URL for GET /api/test/login with session + redirect params. */
function buildTestLoginUrl(base: string, returnTo: string): string {
  const params = new URLSearchParams({
    sub: TEST_USER.sub,
    email: TEST_USER.email,
    firstName: TEST_USER.firstName,
    lastName: TEST_USER.lastName,
    returnTo,
  });
  return `${base}/api/test/login?${params.toString()}`;
}

test.describe("Sign-in returnTo redirect flow", () => {
  test.beforeEach(async ({ page }) => {
    // Start each test without an active session.
    await page.context().clearCookies();
  });

  test("unauthenticated visit to a page with HeaderControls shows Sign In button", async ({
    page,
  }) => {
    // /settings uses HeaderControls directly with showLogin defaulting to true.
    await page.goto("/settings");

    const loginBtn = page.getByTestId("button-header-login");
    await expect(loginBtn).toBeVisible({ timeout: 15_000 });
    await expect(loginBtn).toContainText("Sign In");
  });

  test("Sign In button encodes current path as returnTo query param", async ({
    page,
  }) => {
    const protectedPath = "/settings";
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
    const protectedPath = "/settings";

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

    // Derive the origin from the current page URL so the test works in any
    // environment (local dev, CI, staged) without a hardcoded base URL.
    const origin = new URL(page.url()).origin;

    // Step 3: Simulate the post-OIDC callback by navigating to GET /api/test/login
    // with the captured returnTo.  The endpoint creates a real session and issues
    // a 302 redirect — the browser follows that redirect naturally without any
    // manual page.goto() call driving the final destination.
    await page.goto(buildTestLoginUrl(origin, capturedReturnTo));

    // page.goto follows redirects; waitForURL makes the assertion explicit.
    await page.waitForURL(`**${protectedPath}`, { timeout: 15_000 });

    // Step 4: Assert the browser is on the correct URL — not just "/".
    expect(new URL(page.url()).pathname).toBe(protectedPath);

    // The header Sign In button must be gone — we're authenticated now.
    await expect(page.getByTestId("button-header-login")).not.toBeVisible({
      timeout: 10_000,
    });

    // The page must render authenticated content (proves we're on /settings).
    await expect(page.getByText("Preferences")).toBeVisible({ timeout: 10_000 });
  });

  test("returnTo preserves path AND query string (matches queryClient 401 handler)", async ({
    page,
  }) => {
    // The queryClient 401 handler uses:
    //   window.location.pathname + window.location.search
    // This test verifies the header Sign In button uses the same formula by
    // navigating to a path with a query string and checking the encoded value.
    const pathWithSearch = "/settings?tab=account";
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
