/**
 * End-to-end test: the session-expired toast's "Sign in again" button fires
 * on the *MutationCache* 401 path, not just the QueryCache path.
 *
 * `client/src/lib/queryClient.tsx` wires `handleGlobalError` into both
 * `MutationCache.onError` and `QueryCache.onError`. The existing
 * `401-toast-return-to.spec.ts` covers the QueryCache path (GET returns 401).
 * This spec covers the complementary MutationCache path: a DELETE mutation
 * returns 401 mid-action and the same toast + returnTo behaviour is expected.
 *
 * Strategy
 * --------
 * 1. Create a real server session so `isAuthenticated` is true on the client.
 * 2. Stub GET /api/conversions to return a minimal fake conversion so the
 *    history page renders a row with a delete button (no real DB records needed).
 * 3. Stub DELETE /api/conversions/* to return 401.
 * 4. Navigate to /pdf-accessibility/history, click the delete button, accept
 *    the browser confirm() dialog, and assert the "Session expired" toast.
 * 5. Click "Sign in again" and verify the /api/login redirect encodes the
 *    current pathname as `returnTo`.
 *
 * Run with:
 *   PLAYWRIGHT_TEST=1 npx playwright test e2e/401-mutation-toast.spec.ts
 */

import { test, expect } from "@playwright/test";

const TEST_USER = {
  sub: "pw-401-mutation-toast-user",
  email: "pw401mutation@bridgew.edu",
  firstName: "Playwright",
  lastName: "MutationToast",
};

/**
 * Minimal fake conversion that satisfies the history-page renderer.
 * The filename includes "report" so the `?q=report` search filter in the
 * second test does not hide the row.
 */
const FAKE_CONVERSION = {
  id: 99999,
  userId: TEST_USER.sub,
  originalFilename: "accessibility-report.pdf",
  status: "completed",
  fileSize: 102400,
  pageCount: 3,
  sourceType: "pdf",
  createdAt: new Date().toISOString(),
  complianceReport: { overallScore: 95 },
};

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
  await page.goto(`/api/test/login?${params.toString()}`);
  await page.waitForURL(`**${landingPath}`, { timeout: 15_000 });
}

test.describe("401 MutationCache path — session-expired toast", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test("delete mutation 401 shows 'Session expired' toast with correct returnTo", async ({
    page,
  }) => {
    const targetPath = "/pdf-accessibility/history";

    // Land on a different page first so the conversions query cache is empty.
    await loginAndLandOn(page, "/settings");

    // Stub the conversions list to return one fake entry so the UI renders
    // a row with a delete button — no real database record needed.
    await page.route("**/api/conversions", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([FAKE_CONVERSION]),
        });
      } else {
        route.continue();
      }
    });

    // Stub the DELETE to return 401, simulating a session expiry that occurs
    // mid-action (the user's session token has expired on the server but the
    // browser still holds an auth cookie that passes the /api/auth/user check).
    await page.route(`**/api/conversions/${FAKE_CONVERSION.id}`, (route) => {
      if (route.request().method() === "DELETE") {
        route.fulfill({
          status: 401,
          body: "Unauthorized",
          contentType: "text/plain",
        });
      } else {
        route.continue();
      }
    });

    // Accept the confirm() dialog that the delete button triggers.
    page.on("dialog", (dialog) => dialog.accept());

    // Navigate to the history page.
    await page.goto(targetPath);

    // Wait for the fake conversion row to appear.
    const deleteButton = page.getByRole("button", {
      name: /delete/i,
    });
    await expect(deleteButton).toBeVisible({ timeout: 10_000 });

    // Trigger the delete mutation — this fires the stubbed 401 DELETE.
    await deleteButton.click();

    // The MutationCache onError handler should show the session-expired toast.
    // Use .first() to avoid strict-mode violations: the shadcn toast renders
    // both a visible title element and an ARIA live-region span that both
    // match the same text.
    await expect(page.getByText("Session expired").first()).toBeVisible({
      timeout: 10_000,
    });
    const signInButton = page.getByRole("button", { name: "Sign in again" });
    await expect(signInButton).toBeVisible({ timeout: 5_000 });

    // Intercept the /api/login navigation and abort so we stay on the page.
    const loginRequestPromise = page.waitForRequest("**/api/login*");
    await page.route("**/api/login*", (route) => route.abort());

    await signInButton.click();

    const loginRequest = await loginRequestPromise;
    const loginUrl = new URL(loginRequest.url());
    const returnTo = loginUrl.searchParams.get("returnTo");

    // returnTo must encode the pathname the user was on when the toast fired.
    expect(returnTo).toBe(targetPath);
  });

  test("delete mutation 401 returnTo preserves pathname AND query string", async ({
    page,
  }) => {
    // Verifies that window.location.search is included — same guarantee the
    // QueryCache path tests check in 401-toast-return-to.spec.ts.
    const targetPath = "/pdf-accessibility/history";
    const targetSearch = "?q=report";
    const fullTarget = targetPath + targetSearch;

    await loginAndLandOn(page, "/settings");

    await page.route("**/api/conversions", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([FAKE_CONVERSION]),
        });
      } else {
        route.continue();
      }
    });

    await page.route(`**/api/conversions/${FAKE_CONVERSION.id}`, (route) => {
      if (route.request().method() === "DELETE") {
        route.fulfill({
          status: 401,
          body: "Unauthorized",
          contentType: "text/plain",
        });
      } else {
        route.continue();
      }
    });

    page.on("dialog", (dialog) => dialog.accept());

    // Navigate with a query string in the URL.
    await page.goto(fullTarget);

    const deleteButton = page.getByRole("button", { name: /delete/i });
    await expect(deleteButton).toBeVisible({ timeout: 10_000 });
    await deleteButton.click();

    await expect(page.getByText("Session expired").first()).toBeVisible({
      timeout: 10_000,
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
