/**
 * End-to-end test: Fix All pipeline writes manual-fix items to the server.
 *
 * The companion spec (pdf-conversion-manual-fix.spec.ts) seeds manual-fix
 * items directly into the database, bypassing Fix All entirely. This spec
 * exercises the actual Fix All pipeline:
 *
 *   1. Seed a completed conversion with a compliance report that contains
 *      fixable issues (status "fail") but NO pre-seeded manualFixItems.
 *   2. Navigate to the result page.
 *   3. Intercept POST /api/conversions/:id/fix-issue with page.route() and
 *      return a stub response containing a predictable noFixReason — so the
 *      Anthropic API is never called.
 *   4. Click the "Fix All" button and wait for the manual-fix summary panel
 *      to appear (proves the client processed the noFixReason).
 *   5. Wait for the PUT /api/conversions/:id/manual-fixes sync call to land
 *      (the sync effect fires automatically after manualFixSummary state changes).
 *   6. Reload the page (clears all React state) and assert the items are still
 *      shown — proving they were persisted to the database, not just held in memory.
 *
 * Run with:
 *   PLAYWRIGHT_TEST=1 npx playwright test e2e/pdf-conversion-fix-all-sync.spec.ts
 */

import { test, expect, type Page, type Route } from "@playwright/test";
import { loginAndRedirect } from "./helpers/auth";

const TEST_USER = {
  sub: "pw-fix-all-sync-test-user",
  email: "pwfixallsync@bridgew.edu",
  firstName: "Playwright",
  lastName: "FixAllSync",
};

/** Compliance report with two fixable issues (status "fail"). */
const COMPLIANCE_REPORT = {
  overallScore: 50,
  issues: [
    {
      title: "Missing image alt text",
      status: "fail",
      description: "All images must have descriptive alternative text.",
    },
    {
      title: "Low colour contrast",
      status: "fail",
      description: "Text must meet WCAG AA contrast ratio of 4.5:1.",
    },
  ],
};

/**
 * Stub response returned by the intercepted fix-issue endpoint.
 * Returning a noFixReason causes the client to add the issue to
 * manualFixItems and ultimately PUT it to /api/conversions/:id/manual-fixes.
 */
function makeStubFixResponse(
  conversionId: number,
  issueIndex: number,
): object {
  return {
    id: conversionId,
    originalFilename: "lecture-notes.pdf",
    fileSize: 1024,
    sourceType: "pdf",
    status: "completed",
    pageCount: null,
    extractedText: null,
    accessibleHtml: "<h1>Test Document</h1><p>Stub accessible content.</p>",
    complianceReport: COMPLIANCE_REPORT,
    originalComplianceReport: COMPLIANCE_REPORT,
    errorMessage: null,
    ocrApplied: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    wasRetried: false,
    elementsFixed: 0,
    noFixReason:
      issueIndex === 0
        ? "This image requires a human-written description that captures its instructional meaning."
        : "Contrast ratio depends on the final page design and must be adjusted manually.",
  };
}

async function seedConversionWithComplianceReport(
  page: Page,
): Promise<number> {
  const resp = await page.request.post("/api/test/seed-conversion", {
    data: {
      userId: TEST_USER.sub,
      originalFilename: "lecture-notes.pdf",
      complianceReport: COMPLIANCE_REPORT,
      // Deliberately no manualFixItems — Fix All must create them.
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

test.describe(
  "PDF Conversion — Fix All writes manual-fix items to the server",
  () => {
    test("Fix All produces manual-fix items that survive a page reload", async ({
      page,
    }) => {
      await loginAndRedirect(page, "/", TEST_USER);
      const conversionId = await seedConversionWithComplianceReport(page);

      // Intercept fix-issue calls and return a stub noFixReason so the
      // Anthropic API is never invoked.  The issueIndex is extracted from the
      // request body so each stub response carries the right per-issue reason.
      let interceptedCount = 0;
      await page.route(
        `**/api/conversions/${conversionId}/fix-issue`,
        async (route: Route) => {
          interceptedCount++;
          const body = route.request().postDataJSON() as {
            issueIndex: number;
          };
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(
              makeStubFixResponse(conversionId, body.issueIndex),
            ),
          });
        },
      );

      // Navigate to the result page and wait for the compliance section.
      await page.goto(`/pdf-accessibility/${conversionId}`);

      // The Fix All button is rendered only when fixable issues exist.
      const fixAllButton = page.getByTestId("button-fix-all");
      await expect(fixAllButton).toBeVisible({ timeout: 15_000 });

      // Set up a promise that resolves when the server receives the PUT for
      // manual-fixes — confirming the sync effect fired and the DB was written.
      const putSynced = page.waitForRequest(
        (req) =>
          req.method() === "PUT" &&
          req.url().includes(`/api/conversions/${conversionId}/manual-fixes`),
        { timeout: 20_000 },
      );

      // Click Fix All.
      await fixAllButton.click();

      // The manual-fix summary panel should appear once the pipeline finishes.
      const summary = page.getByTestId("manual-fix-summary");
      await expect(summary).toBeVisible({ timeout: 30_000 });

      // Both issues should be listed as manual-fix items.
      await expect(page.getByTestId("manual-fix-item-0")).toBeVisible();
      await expect(page.getByTestId("manual-fix-item-0")).toContainText(
        COMPLIANCE_REPORT.issues[0].title,
      );
      await expect(page.getByTestId("manual-fix-item-1")).toBeVisible();
      await expect(page.getByTestId("manual-fix-item-1")).toContainText(
        COMPLIANCE_REPORT.issues[1].title,
      );

      // Confirm Fix All actually called fix-issue for each fixable issue.
      expect(interceptedCount).toBe(COMPLIANCE_REPORT.issues.length);

      // Wait for the PUT to reach the server before reloading.
      await putSynced;

      // Reload — this clears all React state and re-fetches from the server.
      await page.reload();

      // The summary must still appear, this time fetched from the database.
      const summaryAfterReload = page.getByTestId("manual-fix-summary");
      await expect(summaryAfterReload).toBeVisible({ timeout: 15_000 });

      await expect(page.getByTestId("manual-fix-item-0")).toBeVisible();
      await expect(page.getByTestId("manual-fix-item-0")).toContainText(
        COMPLIANCE_REPORT.issues[0].title,
      );
      await expect(page.getByTestId("manual-fix-item-1")).toBeVisible();
      await expect(page.getByTestId("manual-fix-item-1")).toContainText(
        COMPLIANCE_REPORT.issues[1].title,
      );
    });

    test("Fix All item count in the summary header survives a reload", async ({
      page,
    }) => {
      await loginAndRedirect(page, "/", TEST_USER);
      const conversionId = await seedConversionWithComplianceReport(page);

      await page.route(
        `**/api/conversions/${conversionId}/fix-issue`,
        async (route: Route) => {
          const body = route.request().postDataJSON() as {
            issueIndex: number;
          };
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(
              makeStubFixResponse(conversionId, body.issueIndex),
            ),
          });
        },
      );

      await page.goto(`/pdf-accessibility/${conversionId}`);
      await expect(page.getByTestId("button-fix-all")).toBeVisible({
        timeout: 15_000,
      });

      const putSynced = page.waitForRequest(
        (req) =>
          req.method() === "PUT" &&
          req.url().includes(`/api/conversions/${conversionId}/manual-fixes`),
        { timeout: 20_000 },
      );

      await page.getByTestId("button-fix-all").click();

      const summary = page.getByTestId("manual-fix-summary");
      await expect(summary).toBeVisible({ timeout: 30_000 });
      await expect(summary).toContainText(
        `${COMPLIANCE_REPORT.issues.length} issues`,
      );

      await putSynced;
      await page.reload();

      const summaryAfterReload = page.getByTestId("manual-fix-summary");
      await expect(summaryAfterReload).toBeVisible({ timeout: 15_000 });
      await expect(summaryAfterReload).toContainText(
        `${COMPLIANCE_REPORT.issues.length} issues`,
      );
    });
  },
);
