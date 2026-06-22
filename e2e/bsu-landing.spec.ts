/**
 * Smoke tests for the BSU faculty landing page (/bsu).
 *
 * /bsu is the faculty-specific entry point linked from the CAI landing page.
 * These tests verify the key elements present for an unauthenticated visitor:
 *   1. The "Accessibility Tool" hero heading is visible.
 *   2. The BSU login CTA is present and points to /api/login.
 *   3. The Accessibility Converter card is visible (open to everyone, no login needed).
 *
 * Run with:
 *   npx playwright test e2e/bsu-landing.spec.ts
 */

import { test, expect } from "@playwright/test";

test.describe("BSU faculty landing page smoke tests", () => {
  test("hero heading is visible on /bsu", async ({ page }) => {
    await page.goto("/bsu");

    const heading = page.locator("h1");
    await expect(heading).toBeVisible({ timeout: 15_000 });
    await expect(heading).toContainText("Accessibility Tool");
  });

  test("BSU login CTA is present", async ({ page }) => {
    await page.goto("/bsu");

    const loginBtn = page.getByTestId("button-login-bsu");
    await expect(loginBtn).toBeVisible({ timeout: 15_000 });
    await expect(loginBtn).toContainText("Sign In with BSU Account");
  });

  test("Accessibility Converter card is visible without login", async ({
    page,
  }) => {
    await page.goto("/bsu");

    const converterCard = page.getByTestId("card-pdf-accessibility");
    await expect(converterCard).toBeVisible({ timeout: 15_000 });
  });
});
