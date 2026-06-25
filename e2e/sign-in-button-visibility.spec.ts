/**
 * Parameterized sign-in button visibility matrix.
 *
 * This spec complements sign-in-redirect.spec.ts by checking every public
 * page and verifying whether `button-header-login` is visible or deliberately
 * absent to unauthenticated visitors.
 *
 * Two categories of page are covered:
 *
 * SHOWS Sign In — pages that use HeaderControls with showLogin defaulting to
 * true.  A regression that accidentally removes the button (e.g. swapping to
 * ConverterHeader or passing showLogin={false}) will be caught here.
 *
 * HIDES Sign In — pages that intentionally suppress the button, either by
 * passing showLogin={false} explicitly (CaiLandingPage) or by rendering
 * ConverterHeader instead of HeaderControls (pdf-upload, pdf-faq, etc.).  A
 * regression that accidentally adds the button to these pages would also be
 * caught.
 *
 * Run with:
 *   PLAYWRIGHT_TEST=1 npx playwright test e2e/sign-in-button-visibility.spec.ts
 */

import { test, expect } from "@playwright/test";

/** Pages where the Sign In button MUST be visible to unauthenticated visitors. */
const PAGES_WITH_SIGN_IN: Array<{ path: string; label: string }> = [
  {
    path: "/help",
    label: "/help (HeaderControls, showLogin defaults to true)",
  },
];

/**
 * Pages where the Sign In button MUST NOT appear for unauthenticated visitors.
 *
 * - "/"   → CaiLandingPage passes showLogin={false} explicitly.
 * - "/accessibility" and "/pdf-accessibility" → PdfUpload uses ConverterHeader
 *   which hard-codes showLogin={false}.
 * - "/pdf-accessibility/faq" → PdfFaq also uses ConverterHeader.
 */
const PAGES_WITHOUT_SIGN_IN: Array<{ path: string; label: string }> = [
  {
    path: "/",
    label: "/ (CaiLandingPage, showLogin={false})",
  },
  {
    path: "/accessibility",
    label: "/accessibility (ConverterHeader, showLogin={false})",
  },
  {
    path: "/pdf-accessibility",
    label: "/pdf-accessibility (ConverterHeader, showLogin={false})",
  },
  {
    path: "/pdf-accessibility/faq",
    label: "/pdf-accessibility/faq (ConverterHeader, showLogin={false})",
  },
];

test.describe("Sign In button visibility — unauthenticated visitors", () => {
  test.beforeEach(async ({ page }) => {
    // Ensure no active session for each test.
    await page.context().clearCookies();
  });

  for (const { path, label } of PAGES_WITH_SIGN_IN) {
    test(`Sign In button IS visible on ${label}`, async ({ page }) => {
      await page.goto(path);

      const loginBtn = page.getByTestId("button-header-login");
      await expect(loginBtn).toBeVisible({ timeout: 15_000 });
      await expect(loginBtn).toContainText("Sign In");
    });

    test(`Sign In button on ${label} encodes path as returnTo`, async ({
      page,
    }) => {
      await page.goto(path);

      const loginBtn = page.getByTestId("button-header-login");
      await expect(loginBtn).toBeVisible({ timeout: 15_000 });

      // Intercept the /api/login navigation to inspect the URL it builds.
      const loginRequestPromise = page.waitForRequest("**/api/login*");
      await page.route("**/api/login*", (route) => route.abort());

      await loginBtn.click();

      const loginRequest = await loginRequestPromise;
      const loginUrl = new URL(loginRequest.url());
      const returnTo = loginUrl.searchParams.get("returnTo");

      // returnTo must match the path that was loaded when Sign In was clicked.
      expect(returnTo).toBe(path);
    });
  }

  for (const { path, label } of PAGES_WITHOUT_SIGN_IN) {
    test(`Sign In button is NOT shown on ${label}`, async ({ page }) => {
      await page.goto(path);

      // Wait for the page to settle so we're not checking before React renders.
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
        // networkidle can time-out on pages with polling; falling through is fine
        // because the DOM assertion below still waits its own timeout.
      });

      // The button must not be in the DOM at all (or at least not visible).
      await expect(page.getByTestId("button-header-login")).not.toBeVisible({
        timeout: 10_000,
      });
    });
  }
});
