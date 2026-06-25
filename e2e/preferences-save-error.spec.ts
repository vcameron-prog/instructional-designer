/**
 * End-to-end test: the Preferences page shows the "Save failed" indicator
 * and a destructive "Preferences not saved" toast when PATCH /api/preferences
 * returns a 500 error.
 *
 * The onError handler and data-testid="status-sync-error" indicator were added
 * to settings.tsx but were previously untested.  This spec ensures a future
 * refactor cannot silently break that error feedback path.
 *
 * Strategy
 * --------
 * 1. Create a real authenticated session via GET /api/test/login so
 *    `isAuthenticated` is true on the client (required for the sync-status
 *    indicator to render).
 * 2. Stub GET /api/preferences to return an empty prefs object so the page
 *    loads cleanly without server state.
 * 3. Stub PATCH /api/preferences to return 500, simulating a server error.
 * 4. Navigate to /settings and toggle a checkbox to trigger saveMutation.
 * 5. Assert data-testid="status-sync-error" becomes visible.
 * 6. Assert a destructive toast with title "Preferences not saved" appears.
 *
 * Run with:
 *   PLAYWRIGHT_TEST=1 npx playwright test e2e/preferences-save-error.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";

const TEST_USER = {
  sub: "pw-prefs-error-test-user",
  email: "pw-prefs-error@bridgew.edu",
  firstName: "Playwright",
  lastName: "PrefsError",
};

/**
 * Log in via GET /api/test/login?... which creates a real session and issues a
 * 302 redirect; the browser follows it naturally.  This avoids the
 * page.evaluate + form.submit approach which can fail on about:blank.
 */
async function loginAndLandOn(page: Page, landingPath: string): Promise<void> {
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

test.describe("Preferences page — save error state", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test("status-sync-error is visible and destructive toast fires when PATCH /api/preferences returns 500", async ({
    page,
  }) => {
    // Step 1: Land on /settings via the dev-only test login endpoint.
    // Landing directly on /settings means routes can be registered before any
    // preferences request is made by the page.
    await loginAndLandOn(page, "/settings");

    // Step 2: Register route stubs now that we're authenticated and on the page.
    // Re-navigate will re-fetch preferences through these stubs.
    await page.route("**/api/preferences", (route) => {
      if (route.request().method() === "GET") {
        // Return empty prefs so the page hydrates cleanly.
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({}),
        });
      } else if (route.request().method() === "PATCH") {
        // Step 3: Return 500 to trigger the onError path.
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "Internal Server Error" }),
        });
      } else {
        route.continue();
      }
    });

    // Re-navigate to /settings so the GET /api/preferences goes through the stub.
    await page.goto("/settings");

    // Wait for the sync status indicator — it only renders when authenticated.
    const syncStatus = page.getByTestId("status-sync");
    await expect(syncStatus).toBeVisible({ timeout: 15_000 });

    // Step 4: Toggle a preference checkbox to trigger the PATCH mutation.
    const autoExpandCheckbox = page.getByTestId("checkbox-settings-auto-expand");
    await expect(autoExpandCheckbox).toBeVisible({ timeout: 5_000 });
    await autoExpandCheckbox.click();

    // Step 5: The "Save failed" error indicator must appear once the stubbed
    // 500 response resolves and the onError handler fires.
    const errorLabel = page.getByTestId("status-sync-error");
    await expect(errorLabel).toBeVisible({ timeout: 10_000 });
    await expect(errorLabel).toContainText("Save failed");

    // Step 6: The destructive toast with title "Preferences not saved" must
    // appear.  Use .first() to avoid strict-mode failures: the shadcn toast
    // renders both a visible title element and an ARIA live-region span.
    await expect(
      page.getByText("Preferences not saved").first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
