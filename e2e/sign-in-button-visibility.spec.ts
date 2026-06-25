/**
 * Parameterized sign-in button visibility matrix.
 *
 * This spec reads the route registry from client/src/lib/route-visibility.ts
 * and generates the test matrix at runtime.  New routes annotated there are
 * automatically covered — no manual spec edits needed.
 *
 * Two categories are tested:
 *
 *   showSignIn: true  — the Sign-In button MUST be visible to unauthenticated
 *                        visitors (HeaderControls without suppression).
 *   showSignIn: false — the Sign-In button MUST NOT appear (ConverterHeader or
 *                        showLogin={false} explicitly passed).
 *
 * Routes where showSignIn is undefined are excluded: they either require auth
 * (redirect before render) or contain dynamic path segments that need a real
 * database record (e.g. /pdf-accessibility/:id).
 *
 * Run with:
 *   PLAYWRIGHT_TEST=1 npx playwright test e2e/sign-in-button-visibility.spec.ts
 */

import { test, expect } from "@playwright/test";
import { ROUTE_VISIBILITY } from "../client/src/lib/route-visibility";

const testableRoutes = ROUTE_VISIBILITY.filter(
  (r) => r.showSignIn !== undefined,
);

const withSignIn    = testableRoutes.filter((r) => r.showSignIn === true);
const withoutSignIn = testableRoutes.filter((r) => r.showSignIn === false);

test.describe("Sign In button visibility — unauthenticated visitors", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  for (const { path } of withSignIn) {
    test(`Sign In button IS visible on ${path}`, async ({ page }) => {
      await page.goto(path);

      const loginBtn = page.getByTestId("button-header-login");
      await expect(loginBtn).toBeVisible({ timeout: 15_000 });
      await expect(loginBtn).toContainText("Sign In");
    });

    test(`Sign In button on ${path} encodes path as returnTo`, async ({
      page,
    }) => {
      await page.goto(path);

      const loginBtn = page.getByTestId("button-header-login");
      await expect(loginBtn).toBeVisible({ timeout: 15_000 });

      const loginRequestPromise = page.waitForRequest("**/api/login*");
      await page.route("**/api/login*", (route) => route.abort());

      await loginBtn.click();

      const loginRequest = await loginRequestPromise;
      const loginUrl = new URL(loginRequest.url());
      const returnTo = loginUrl.searchParams.get("returnTo");

      expect(returnTo).toBe(path);
    });
  }

  for (const { path } of withoutSignIn) {
    test(`Sign In button is NOT shown on ${path}`, async ({ page }) => {
      await page.goto(path);

      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
        // networkidle can time-out on pages with polling; the DOM assertion
        // below still applies its own timeout so this is safe to swallow.
      });

      await expect(page.getByTestId("button-header-login")).not.toBeVisible({
        timeout: 10_000,
      });
    });
  }
});
