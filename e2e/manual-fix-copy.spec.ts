/**
 * End-to-end tests for the "Copy list" button on the manual-fix summary banner.
 *
 * The banner appears after "Fix All" is run on a document that contains at
 * least one issue that cannot be automatically corrected.  The test uses a
 * deliberately un-fixable document (body contains only landmark elements, so
 * the Bypass Blocks fixer has nothing to wrap in <main>) to guarantee the
 * banner is shown without hitting the AI API.
 *
 * Auth setup: uses the dev-only POST /api/test/login endpoint (PLAYWRIGHT_TEST=1).
 * Data setup: uses POST /api/test/seed-conversion to inject a "completed"
 * conversion row with a known compliance report, bypassing the upload pipeline.
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_USER = {
  sub: "pw-manual-fix-copy-user",
  email: "pw-manualfix@bridgew.edu",
  firstName: "Playwright",
  lastName: "CopyTest",
};

/**
 * HTML that deterministically triggers the "all-landmarks-no-content"
 * edge case in the engine: the body contains only landmark elements so the
 * Bypass Blocks fixer cannot insert a <main> region and returns noFixReason.
 */
const ALL_LANDMARKS_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>T</title></head>' +
  "<body>" +
  "<header><p>Site header</p></header>" +
  '<nav><a href="#">Home</a></nav>' +
  "<footer><p>Footer</p></footer>" +
  "</body></html>";

/**
 * Minimal compliance report that matches the issue the engine will encounter.
 * The issue title ("Bypass Blocks") surfaces in the manual-fix banner and in
 * the clipboard text, so it must match exactly.
 */
const SEED_COMPLIANCE_REPORT = {
  score: 50,
  issues: [
    {
      criterion: "2.4.1",
      title: "Bypass Blocks",
      status: "warning",
      wcagLevel: "A",
      description:
        "The page must have a mechanism to bypass blocks of content that are repeated on multiple pages.",
      details:
        "This document contains header, navigation, or footer sections but has no main content area. " +
        "All body content appears to be inside landmark elements, so no <main> region could be identified. " +
        'Add a <main> element (or role="main" on a wrapper) to clearly mark where the primary content begins, ' +
        "so screen reader users can skip directly to it.",
    },
  ],
};

/**
 * The noFixReason string returned by the engine for the all-landmarks case.
 * This is the text that the "Copy list" button writes to the clipboard
 * (prefixed with the issue title).
 */
const NO_FIX_REASON =
  "This document contains only landmark elements (header, nav, footer) with no primary " +
  "content outside them, so there is nothing to automatically wrap in a <main> region. " +
  "To fix this manually: add a <main> element around your primary page content, or add " +
  'role="main" to the landmark that holds the main information.';

const EXPECTED_CLIPBOARD_TEXT = `\u2022 Bypass Blocks: ${NO_FIX_REASON}`;

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

async function seedConversion(page: Page): Promise<number> {
  const resp = await page.request.post("/api/test/seed-conversion", {
    data: {
      userId: TEST_USER.sub,
      accessibleHtml: ALL_LANDMARKS_HTML,
      complianceReport: SEED_COMPLIANCE_REPORT,
      originalFilename: "landmarks-only.pdf",
    },
  });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(`Seed conversion failed (${resp.status()}): ${body}`);
  }
  const json = (await resp.json()) as { id: number };
  return json.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Manual-fix copy button", () => {
  test("clicking 'Copy list' writes the issue list to the clipboard and shows 'Copied!' confirmation", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const conversionId = await seedConversion(page);

    // Grant clipboard permissions so page.evaluate can read from the clipboard.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.goto(`/pdf-accessibility/${conversionId}`);

    // Wait for the page to display the Fix All button, which only appears once
    // the compliance report has loaded and there are fixable issues.
    const fixAllBtn = page.getByTestId("button-fix-all");
    await expect(fixAllBtn).toBeVisible({ timeout: 15_000 });

    // Run Fix All.  The engine will process the single "Bypass Blocks" warning
    // and return noFixReason, causing the manual-fix summary banner to appear.
    await fixAllBtn.click();

    // Wait for the manual-fix summary banner to become visible.
    const banner = page.getByTestId("manual-fix-summary");
    await expect(banner).toBeVisible({ timeout: 20_000 });

    // Verify the banner contains the expected issue title.
    await expect(banner).toContainText("Bypass Blocks");

    // Click "Copy list".
    const copyBtn = page.getByTestId("button-copy-manual-fix-list");
    await expect(copyBtn).toBeVisible();
    await expect(copyBtn).toContainText("Copy list");

    await copyBtn.click();

    // The button label should immediately change to "Copied!".
    await expect(copyBtn).toContainText("Copied!", { timeout: 3_000 });

    // Read from the system clipboard and verify content.
    const clipboardText: string = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(clipboardText).toBe(EXPECTED_CLIPBOARD_TEXT);

    // After 2 seconds the label reverts to "Copy list".
    await expect(copyBtn).toContainText("Copy list", { timeout: 4_000 });
  });
});
