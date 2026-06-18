/**
 * End-to-end test: manual-fix items survive a page reload.
 *
 * The server-sync flow (GET/PUT /api/conversions/:id/manual-fixes) stores
 * manual-fix items in the database so they are restored when a faculty member
 * navigates away and comes back.  This test proves that round-trip works without
 * running the full Fix All pipeline or hitting the Anthropic API.
 *
 * Strategy:
 *   1. Log in as a synthetic test user via POST /api/test/login.
 *   2. Seed a completed conversion that already has manualFixItems set in the DB
 *      via POST /api/test/seed-conversion (PLAYWRIGHT_TEST=1 only).
 *   3. Navigate to /pdf-accessibility/:id and confirm the manual-fix summary
 *      panel is visible with the expected items.
 *   4. Reload the page and assert the items are still shown (proving they were
 *      fetched from the server, not only from in-memory state).
 *
 * Run with:
 *   PLAYWRIGHT_TEST=1 npx playwright test e2e/pdf-conversion-manual-fix.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";

const TEST_USER = {
  sub: "pw-manual-fix-test-user",
  email: "pwmanualfix@bridgew.edu",
  firstName: "Playwright",
  lastName: "ManualFix",
};

const MANUAL_FIX_ITEMS = [
  {
    title: "Missing image alt text",
    reason: "Image at line 42 has no alternative text and cannot be auto-fixed.",
  },
  {
    title: "Complex data table",
    reason: "Table spanning rows and columns requires manual header associations.",
  },
];

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

async function seedConversionWithManualFixes(page: Page): Promise<number> {
  const resp = await page.request.post("/api/test/seed-conversion", {
    data: {
      userId: TEST_USER.sub,
      originalFilename: "lecture-notes.pdf",
      manualFixItems: MANUAL_FIX_ITEMS,
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

test.describe("PDF Conversion — manual-fix items persist across reload", () => {
  test("manual-fix summary is visible on load and survives a page reload", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const conversionId = await seedConversionWithManualFixes(page);

    // Navigate to the conversion result page.
    await page.goto(`/pdf-accessibility/${conversionId}`);

    // The manual-fix summary panel should be visible once the page loads.
    const summary = page.getByTestId("manual-fix-summary");
    await expect(summary).toBeVisible({ timeout: 15_000 });

    // Both seeded items should appear.
    await expect(page.getByTestId("manual-fix-item-0")).toBeVisible();
    await expect(page.getByTestId("manual-fix-item-0")).toContainText(
      MANUAL_FIX_ITEMS[0].title,
    );
    await expect(page.getByTestId("manual-fix-item-1")).toBeVisible();
    await expect(page.getByTestId("manual-fix-item-1")).toContainText(
      MANUAL_FIX_ITEMS[1].title,
    );

    // Reload the page — this clears all in-memory React state and re-fetches
    // from the server, so the items must come from the database.
    await page.reload();

    const summaryAfterReload = page.getByTestId("manual-fix-summary");
    await expect(summaryAfterReload).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("manual-fix-item-0")).toBeVisible();
    await expect(page.getByTestId("manual-fix-item-0")).toContainText(
      MANUAL_FIX_ITEMS[0].title,
    );
    await expect(page.getByTestId("manual-fix-item-1")).toBeVisible();
    await expect(page.getByTestId("manual-fix-item-1")).toContainText(
      MANUAL_FIX_ITEMS[1].title,
    );
  });

  test("manual-fix item count in the summary header survives a reload", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const conversionId = await seedConversionWithManualFixes(page);

    await page.goto(`/pdf-accessibility/${conversionId}`);

    const summary = page.getByTestId("manual-fix-summary");
    await expect(summary).toBeVisible({ timeout: 15_000 });
    await expect(summary).toContainText(`${MANUAL_FIX_ITEMS.length} issues`);

    await page.reload();

    const summaryAfterReload = page.getByTestId("manual-fix-summary");
    await expect(summaryAfterReload).toBeVisible({ timeout: 15_000 });
    await expect(summaryAfterReload).toContainText(
      `${MANUAL_FIX_ITEMS.length} issues`,
    );
  });
});
