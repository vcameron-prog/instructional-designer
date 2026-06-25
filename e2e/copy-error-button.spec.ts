/**
 * End-to-end tests for the "Copy" button inside the "Remediation Failed" alert
 * shown when a conversion has status "failed".
 *
 * The test seeds a conversion row with status "failed" and a known errorMessage
 * directly via POST /api/test/seed-conversion, navigating to its detail page
 * and confirming:
 *   - The "Remediation Failed" alert is visible.
 *   - The button labelled "Copy" (data-testid="button-copy-error") is present.
 *   - Clicking it writes the errorMessage to the clipboard.
 *   - The button label immediately changes to "Copied".
 *   - After ~2 seconds the label reverts to "Copy".
 *
 * Auth setup: uses the dev-only POST /api/test/login endpoint (PLAYWRIGHT_TEST=1).
 * Data setup: uses POST /api/test/seed-conversion with status "failed".
 */

import { test, expect, type Page } from "@playwright/test";
import { loginAndRedirect } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_USER = {
  sub: "pw-copy-error-user",
  email: "pw-copyerror@bridgew.edu",
  firstName: "Playwright",
  lastName: "ErrorCopyTest",
};

const KNOWN_ERROR_MESSAGE =
  "AI remediation timed out after processing 12 of 20 sections. " +
  "Please retry the conversion or contact support if the problem persists.";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedFailedConversion(page: Page): Promise<number> {
  const resp = await page.request.post("/api/test/seed-conversion", {
    data: {
      userId: TEST_USER.sub,
      status: "failed",
      errorMessage: KNOWN_ERROR_MESSAGE,
      originalFilename: "remediation-failed.pdf",
    },
  });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(`Seed failed conversion failed (${resp.status()}): ${body}`);
  }
  const json = (await resp.json()) as { id: number };
  return json.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Copy-error button on failed conversions", () => {
  test(
    "button appears for a failed conversion, copies the errorMessage, and shows 'Copied' confirmation",
    async ({ page }) => {
      await loginAndRedirect(page, "/", TEST_USER);
      const conversionId = await seedFailedConversion(page);

      // Grant clipboard permissions so page.evaluate can read from the clipboard.
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

      await page.goto(`/pdf-accessibility/${conversionId}`);

      // The "Remediation Failed" alert must be visible.
      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible({ timeout: 15_000 });
      await expect(alert).toContainText("Remediation Failed");

      // The copy button must be present and labelled "Copy".
      const copyBtn = page.getByTestId("button-copy-error");
      await expect(copyBtn).toBeVisible();
      await expect(copyBtn).toContainText("Copy");

      // Click the button.
      await copyBtn.click();

      // The button label should immediately change to "Copied".
      await expect(copyBtn).toContainText("Copied", { timeout: 3_000 });

      // Read from the system clipboard and verify it contains the known error message.
      const clipboardText: string = await page.evaluate(() =>
        navigator.clipboard.readText(),
      );
      expect(clipboardText).toBe(KNOWN_ERROR_MESSAGE);

      // After 2 seconds the label reverts to "Copy".
      await expect(copyBtn).toContainText("Copy", { timeout: 4_000 });
    },
  );

  test(
    "copy button is absent for a completed conversion",
    async ({ page }) => {
      await loginAndRedirect(page, "/", TEST_USER);

      // Seed a completed conversion (no copy-error button expected).
      const minimalHtml =
        '<!DOCTYPE html><html lang="en"><head><title>T</title></head>' +
        "<body><main><p>Hello world</p></main></body></html>";
      const minimalReport = { score: 100, issues: [] };

      const resp = await page.request.post("/api/test/seed-conversion", {
        data: {
          userId: TEST_USER.sub,
          accessibleHtml: minimalHtml,
          complianceReport: minimalReport,
          originalFilename: "completed-doc.pdf",
        },
      });
      expect(resp.ok()).toBe(true);
      const { id } = (await resp.json()) as { id: number };

      await page.goto(`/pdf-accessibility/${id}`);

      // Wait for the page to settle (completed conversions show the HTML preview panel).
      await expect(page.getByTestId("html-preview")).toBeVisible({ timeout: 15_000 });

      // The copy-error button must not appear for a successful conversion.
      await expect(page.getByTestId("button-copy-error")).not.toBeVisible();
    },
  );
});
