/**
 * End-to-end tests: Content Fidelity section renders correctly on the
 * conversion results page.
 *
 * Covers:
 *  - The action-prompt paragraph is shown when overallStatus === "warning".
 *  - The action-prompt paragraph is absent when overallStatus === "ok".
 *  - The word-count note (mentioning alt text, ARIA labels, heading markup)
 *    is visible beneath the text-coverage finding row.
 *  - The broken-transitions description sentence is visible when
 *    brokenTransitions contains at least one entry.
 *
 * Strategy:
 *   1. Log in via POST /api/test/login.
 *   2. Seed a completed conversion with pre-built contentFidelity JSON via
 *      POST /api/test/seed-conversion (PLAYWRIGHT_TEST=1 only).
 *   3. Navigate to /pdf-accessibility/:id and assert the relevant strings.
 *
 * Run with:
 *   PLAYWRIGHT_TEST=1 npx playwright test e2e/content-fidelity-section.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";
import { loginAndRedirect } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_USER = {
  sub: "pw-content-fidelity-user",
  email: "pw-contentfidelity@bridgew.edu",
  firstName: "Playwright",
  lastName: "ContentFidelity",
};

const MINIMAL_COMPLIANCE_REPORT = {
  overallScore: 95,
  passCount: 10,
  fixedCount: 2,
  warningCount: 0,
  failCount: 0,
  issues: [],
};

const WARNING_CONTENT_FIDELITY = {
  overallStatus: "warning",
  textCoverageRatio: 0.72,
  sourceWordCount: 1200,
  outputWordCount: 950,
  ocrApplied: false,
  brokenTransitions: [
    "...the policy requires that all submitted work be",
    "...students are expected to attend at least",
  ],
  headingOutline: { levels: [1, 2, 3], hasSkippedLevels: false },
  findings: [
    {
      type: "text-coverage",
      status: "warning",
      message: "Output word count is notably lower than the source (950 vs 1200).",
      details: "Some content may have been lost during extraction.",
    },
    {
      type: "heading-structure",
      status: "ok",
      message: "Heading structure looks intact.",
    },
  ],
};

const OK_CONTENT_FIDELITY = {
  overallStatus: "ok",
  textCoverageRatio: 1.05,
  sourceWordCount: 800,
  outputWordCount: 840,
  ocrApplied: false,
  brokenTransitions: [],
  headingOutline: { levels: [1, 2, 3], hasSkippedLevels: false },
  findings: [
    {
      type: "text-coverage",
      status: "ok",
      message: "Word count looks consistent with the source.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedConversionWithFidelity(
  page: Page,
  contentFidelity: unknown,
): Promise<number> {
  const resp = await page.request.post("/api/test/seed-conversion", {
    data: {
      userId: TEST_USER.sub,
      originalFilename: "lecture-notes.pdf",
      status: "completed",
      complianceReport: MINIMAL_COMPLIANCE_REPORT,
      contentFidelity,
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

test.describe("Content Fidelity section rendering", () => {
  test("shows the action-prompt when overallStatus is 'warning'", async ({
    page,
  }) => {
    await loginAndRedirect(page, "/", TEST_USER);
    const id = await seedConversionWithFidelity(page, WARNING_CONTENT_FIDELITY);

    await page.goto(`/pdf-accessibility/${id}`);

    const actionPrompt = page.getByTestId("text-content-fidelity-action-prompt");
    await expect(actionPrompt).toBeVisible({ timeout: 15_000 });
    await expect(actionPrompt).toContainText(
      "Scroll through the converted document and compare it against the original",
    );
  });

  test("hides the action-prompt when overallStatus is 'ok'", async ({
    page,
  }) => {
    await loginAndRedirect(page, "/", TEST_USER);
    const id = await seedConversionWithFidelity(page, OK_CONTENT_FIDELITY);

    await page.goto(`/pdf-accessibility/${id}`);

    // Wait for the content fidelity section to appear before asserting absence.
    await expect(
      page.getByTestId("finding-content-fidelity-text-coverage"),
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByTestId("text-content-fidelity-action-prompt"),
    ).not.toBeVisible();
  });

  test("shows the word-count note beneath the text-coverage finding row", async ({
    page,
  }) => {
    await loginAndRedirect(page, "/", TEST_USER);
    const id = await seedConversionWithFidelity(page, WARNING_CONTENT_FIDELITY);

    await page.goto(`/pdf-accessibility/${id}`);

    const textCoverageRow = page.getByTestId(
      "finding-content-fidelity-text-coverage",
    );
    await expect(textCoverageRow).toBeVisible({ timeout: 15_000 });

    // The inline note must mention alt text, ARIA labels, and heading markup.
    await expect(textCoverageRow).toContainText("Alt text for images");
    await expect(textCoverageRow).toContainText("ARIA labels");
    await expect(textCoverageRow).toContainText("heading markup");
  });

  test("shows the broken-transitions description when brokenTransitions is non-empty", async ({
    page,
  }) => {
    await loginAndRedirect(page, "/", TEST_USER);
    const id = await seedConversionWithFidelity(page, WARNING_CONTENT_FIDELITY);

    await page.goto(`/pdf-accessibility/${id}`);

    // Wait for the content fidelity section to be rendered.
    await expect(
      page.getByTestId("finding-content-fidelity-text-coverage"),
    ).toBeVisible({ timeout: 15_000 });

    // The broken-transitions panel description must be visible.
    await expect(
      page.getByText(
        "These are sentence fragments where the conversion may have split a passage mid-sentence.",
      ),
    ).toBeVisible();
  });
});
