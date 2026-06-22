/**
 * End-to-end tests verifying that the conversion detail page and history list
 * display DISTINCT visual treatment for a google-doc failure versus a plain
 * pdf failure.
 *
 * Specifically:
 *  - A google-doc failed conversion shows a "Google Doc" source-type badge
 *    (data-testid="badge-source-type") on the detail page and a matching
 *    label (data-testid="label-source-type-{id}") on the history page.
 *  - A pdf failed conversion shows NO source-type badge on the detail page
 *    and NO source-type label on the history page.
 *  - Both conversions show the "Remediation Failed" alert.
 *
 * Auth setup: dev-only POST /api/test/login endpoint.
 * Data setup: POST /api/test/seed-conversion called twice with different
 *             sourceType values ("google-doc" and "pdf").
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_USER = {
  sub: "pw-source-type-failure-user",
  email: "pw-sourcetype@bridgew.edu",
  firstName: "Playwright",
  lastName: "SourceTypeTest",
};

const ERROR_MESSAGE =
  "AI remediation failed: the document could not be processed. " +
  "Please retry or contact support.";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loginAsTestUser(page: Page): Promise<void> {
  const resp = await page.request.post("/api/test/login", {
    data: TEST_USER,
  });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(
      `Test login failed (${resp.status()}): ${body}. ` +
        "Make sure the server is started with PLAYWRIGHT_TEST=1.",
    );
  }
}

async function seedFailedConversion(
  page: Page,
  sourceType: string,
  filename: string,
): Promise<number> {
  const resp = await page.request.post("/api/test/seed-conversion", {
    data: {
      userId: TEST_USER.sub,
      status: "failed",
      errorMessage: ERROR_MESSAGE,
      originalFilename: filename,
      sourceType,
    },
  });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(
      `seed-conversion failed (${resp.status()}): ${body}. ` +
        "Make sure the server is started with PLAYWRIGHT_TEST=1.",
    );
  }
  const json = (await resp.json()) as { id: number };
  return json.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Source-type visual treatment on failed conversions", () => {
  test(
    "google-doc failure shows 'Google Doc' badge on the detail page; pdf failure does not",
    async ({ page }) => {
      await loginAsTestUser(page);

      const googleDocId = await seedFailedConversion(
        page,
        "google-doc",
        "course-slides.pdf",
      );
      const pdfId = await seedFailedConversion(
        page,
        "pdf",
        "lecture-notes.pdf",
      );

      // --- Google-doc detail page -------------------------------------------
      await page.goto(`/pdf-accessibility/${googleDocId}`);

      // Both failures share the "Remediation Failed" alert.
      const googleDocAlert = page.getByRole("alert");
      await expect(googleDocAlert).toBeVisible({ timeout: 15_000 });
      await expect(googleDocAlert).toContainText("Remediation Failed");

      // The google-doc source-type badge must be present and readable.
      const googleDocBadge = page.getByTestId("badge-source-type");
      await expect(googleDocBadge).toBeVisible();
      await expect(googleDocBadge).toContainText("Google Doc");

      // --- PDF detail page --------------------------------------------------
      await page.goto(`/pdf-accessibility/${pdfId}`);

      const pdfAlert = page.getByRole("alert");
      await expect(pdfAlert).toBeVisible({ timeout: 15_000 });
      await expect(pdfAlert).toContainText("Remediation Failed");

      // A plain pdf conversion must NOT show any source-type badge.
      await expect(page.getByTestId("badge-source-type")).not.toBeVisible();
    },
  );

  test(
    "history list shows 'Google Doc' label for google-doc failure but not for pdf failure",
    async ({ page }) => {
      await loginAsTestUser(page);

      const googleDocId = await seedFailedConversion(
        page,
        "google-doc",
        "history-google-doc.pdf",
      );
      const pdfId = await seedFailedConversion(
        page,
        "pdf",
        "history-pdf.pdf",
      );

      await page.goto("/pdf-accessibility/history");

      // Wait for at least one history card to render.
      await expect(
        page.getByTestId(`card-history-${googleDocId}`),
      ).toBeVisible({ timeout: 15_000 });

      // The google-doc row must show a source-type label.
      const googleDocLabel = page.getByTestId(
        `label-source-type-${googleDocId}`,
      );
      await expect(googleDocLabel).toBeVisible();
      await expect(googleDocLabel).toContainText("Google Doc");

      // The pdf row must NOT show any source-type label.
      await expect(
        page.getByTestId(`label-source-type-${pdfId}`),
      ).not.toBeVisible();
    },
  );
});
