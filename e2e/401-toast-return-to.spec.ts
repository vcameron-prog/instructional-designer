/**
 * End-to-end test: the session-expired toast's "Sign in again" button captures
 * the right returnTo URL.
 *
 * The queryClient 401 handler (`client/src/lib/queryClient.tsx`) shows a
 * "Session expired" toast with a "Sign in again" action whenever a TanStack
 * Query response returns 401.  That action builds the redirect URL with:
 *
 *   window.location.pathname + window.location.search
 *
 * — the same formula used by the header Sign In button (tested in
 * sign-in-redirect.spec.ts).  This spec closes the gap by exercising the
 * *query-cache 401* code path rather than the header button.
 *
 * Strategy
 * --------
 * 1. Create a real server session via GET /api/test/login so the auth query
 *    (`/api/auth/user`) succeeds and `isAuthenticated` becomes true on the
 *    client.
 * 2. Use page.route() to make the `/api/conversions` endpoint (fetched by the
 *    history page) return 401, simulating a server-side session expiry that the
 *    client has not yet detected (the auth cookie is still technically valid for
 *    the auth endpoint, so `isAuthenticated` stays true and the conversions
 *    query is enabled).
 * 3. Navigate to `/pdf-accessibility/history`.  The conversions query fires
 *    immediately, hits the stubbed 401, and `handleGlobalError` shows the toast.
 * 4. Intercept the `/api/login` navigation from the toast button and assert the
 *    `returnTo` param equals the current path.
 *
 * Run with:
 *   PLAYWRIGHT_TEST=1 npx playwright test e2e/401-toast-return-to.spec.ts
 */

import { test, expect } from "@playwright/test";

const TEST_USER = {
  sub: "pw-401-toast-test-user",
  email: "pw401toast@bridgew.edu",
  firstName: "Playwright",
  lastName: "ToastTest",
};

/**
 * Create a real server session via GET /api/test/login and wait until the
 * browser has landed on `landingPath`.  We land on a page *other than* the
 * test target so the conversions query cache is empty when we later navigate
 * to the history page.
 */
async function loginAndLandOn(
  page: import("@playwright/test").Page,
  landingPath: string,
) {
  const params = new URLSearchParams({
    sub: TEST_USER.sub,
    email: TEST_USER.email,
    firstName: TEST_USER.firstName,
    lastName: TEST_USER.lastName,
    returnTo: landingPath,
  });
  // Use a relative URL so Playwright prepends the configured baseURL.
  await page.goto(`/api/test/login?${params.toString()}`);
  await page.waitForURL(`**${landingPath}`, { timeout: 15_000 });
}

test.describe("401 toast 'Sign in again' returnTo capture", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test("toast 'Sign in again' button encodes the current pathname as returnTo", async ({
    page,
  }) => {
    const targetPath = "/pdf-accessibility/history";

    // Land on /settings so the conversions query is NOT in cache yet.
    await loginAndLandOn(page, "/settings");

    // Stub /api/conversions to return 401 — simulates a server-side session
    // expiry that the browser hasn't detected yet (the auth cookie is still
    // valid for /api/auth/user, so isAuthenticated stays true on the client).
    await page.route("**/api/conversions**", (route) => {
      route.fulfill({
        status: 401,
        body: "Unauthorized",
        contentType: "text/plain",
      });
    });

    // Navigate to the history page.  The auth query resolves the cached user
    // (isAuthenticated = true), the enabled conversions query fires, hits the
    // stubbed 401, and handleGlobalError shows the session-expired toast.
    await page.goto(targetPath);

    await expect(page.getByText("Session expired")).toBeVisible({
      timeout: 15_000,
    });
    const signInButton = page.getByRole("button", { name: "Sign in again" });
    await expect(signInButton).toBeVisible({ timeout: 5_000 });

    // Intercept the /api/login navigation (abort so we stay on the page).
    const loginRequestPromise = page.waitForRequest("**/api/login*");
    await page.route("**/api/login*", (route) => route.abort());

    await signInButton.click();

    const loginRequest = await loginRequestPromise;
    const loginUrl = new URL(loginRequest.url());
    const returnTo = loginUrl.searchParams.get("returnTo");

    // The returnTo must be exactly the path the user was on when the toast fired.
    expect(returnTo).toBe(targetPath);
  });

  test("toast returnTo preserves pathname AND query string (full formula)", async ({
    page,
  }) => {
    // The 401 handler uses: window.location.pathname + window.location.search
    // This test verifies the search-string portion is included, matching the
    // same guarantee tested for the header Sign In button in
    // sign-in-redirect.spec.ts ("returnTo preserves path AND query string").
    const targetPath = "/pdf-accessibility/history";
    const targetSearch = "?q=report&range=7";
    const fullTarget = targetPath + targetSearch;

    await loginAndLandOn(page, "/settings");

    await page.route("**/api/conversions**", (route) => {
      route.fulfill({
        status: 401,
        body: "Unauthorized",
        contentType: "text/plain",
      });
    });

    // Navigate to the history URL with query params in the address bar.
    await page.goto(fullTarget);

    await expect(page.getByText("Session expired")).toBeVisible({
      timeout: 15_000,
    });
    const signInButton = page.getByRole("button", { name: "Sign in again" });
    await expect(signInButton).toBeVisible({ timeout: 5_000 });

    const loginRequestPromise = page.waitForRequest("**/api/login*");
    await page.route("**/api/login*", (route) => route.abort());

    await signInButton.click();

    const loginRequest = await loginRequestPromise;
    const loginUrl = new URL(loginRequest.url());
    const returnTo = loginUrl.searchParams.get("returnTo");

    // Must include both pathname AND search — not just the pathname.
    expect(returnTo).toBe(fullTarget);
  });
});
