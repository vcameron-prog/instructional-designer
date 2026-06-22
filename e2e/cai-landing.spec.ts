/**
 * End-to-end smoke tests for the CAI statewide landing page (/).
 *
 * The CAI landing page is the public root URL and requires no authentication.
 * These tests verify that the key interactive elements are present and functional:
 *   1. The CAI hero heading is visible.
 *   2. "Open Accessibility Converter" navigates to /accessibility.
 *   3. "BSU Faculty Login →" navigates to /faculty.
 *
 * Run with:
 *   npx playwright test e2e/cai-landing.spec.ts
 */

import { test, expect } from "@playwright/test";

test.describe("CAI landing page smoke tests", () => {
  test("hero heading is visible on the root page", async ({ page }) => {
    await page.goto("/");

    const heading = page.getByTestId("heading-cai-main");
    await expect(heading).toBeVisible({ timeout: 15_000 });
    await expect(heading).toContainText(
      "Accessible Documents for All Massachusetts Colleges",
    );
  });

  test("Open Accessibility Converter CTA navigates to /accessibility", async ({
    page,
  }) => {
    await page.goto("/");

    const cta = page.getByTestId("button-open-converter");
    await expect(cta).toBeVisible({ timeout: 15_000 });

    await cta.click();

    await expect(page).toHaveURL(/\/accessibility/, { timeout: 10_000 });
  });

  test("BSU Faculty Login link navigates to /faculty", async ({ page }) => {
    await page.goto("/");

    const bsuLink = page.getByTestId("link-bsu-faculty-login");
    await expect(bsuLink).toBeVisible({ timeout: 15_000 });

    await bsuLink.click();

    await expect(page).toHaveURL(/\/faculty/, { timeout: 10_000 });
  });
});
