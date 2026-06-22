/**
 * End-to-end tests for the RichTextEditor link popover.
 *
 * The rich-text editor appears on the PDF accessibility result page
 * (/pdf-accessibility/:id) when the user switches to "Edit" mode.
 * The link toolbar button opens a popover with three distinct flows:
 *
 *   1. Insert — clicking the button while the cursor is on plain text opens
 *      the popover without a "Current link" preview.
 *   2. Edit   — clicking the button while the cursor is inside an existing
 *      link shows the "Current link" label with the existing href.
 *   3. Confirm edit — typing a new URL and clicking Confirm updates the link
 *      href inside the editor.
 *   4. Remove — clicking the "Remove link" button inside the popover strips
 *      the anchor mark from the text.
 *
 * Auth / seeding:
 *   - POST /api/test/login  (PLAYWRIGHT_TEST=1 only)
 *   - POST /api/test/seed-conversion  (PLAYWRIGHT_TEST=1 only)
 *
 * Run with:
 *   PLAYWRIGHT_TEST=1 npx playwright test e2e/rich-text-editor-link-popover.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_USER = {
  sub: "pw-link-popover-user",
  email: "pw-linkpopover@bridgew.edu",
  firstName: "Playwright",
  lastName: "LinkPopover",
};

/** HTML with a plain-text paragraph and a paragraph containing a hyperlink. */
const SEED_HTML_WITH_LINK =
  '<!DOCTYPE html><html lang="en"><head><title>Link Test</title></head>' +
  "<body>" +
  "<p>Plain text paragraph for cursor placement.</p>" +
  '<p>Visit <a href="https://example.com">our site</a> for more information.</p>' +
  "</body></html>";

/** HTML with plain text only — no links. */
const SEED_HTML_PLAIN =
  '<!DOCTYPE html><html lang="en"><head><title>Plain Test</title></head>' +
  "<body>" +
  "<p>Plain text paragraph only. No links here.</p>" +
  "</body></html>";

/**
 * Minimal compliance report required for the page to render the result grid
 * (and therefore the Accessible HTML editor section with the Edit mode button).
 * The pdf-conversion page only shows the result grid when both
 * `conversion.status === "completed"` AND `report` (complianceReport) is truthy.
 */
const MINIMAL_COMPLIANCE_REPORT = {
  overallScore: 100,
  issues: [],
};

const EXISTING_LINK_HREF = "https://example.com";
const NEW_LINK_HREF = "https://bridgew.edu";

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

async function seedConversionWithHtml(
  page: Page,
  accessibleHtml: string,
  filenameHint = "link-test.pdf",
): Promise<number> {
  const resp = await page.request.post("/api/test/seed-conversion", {
    data: {
      userId: TEST_USER.sub,
      accessibleHtml,
      originalFilename: filenameHint,
      // A compliance report is required for the page to render the result grid
      // (and the Accessible HTML editor section).
      complianceReport: MINIMAL_COMPLIANCE_REPORT,
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

/**
 * Navigate to the conversion result page, switch to Edit mode, and wait for
 * the rich-text editor to be visible.
 */
async function openEditorForConversion(
  page: Page,
  conversionId: number,
): Promise<void> {
  await page.goto(`/pdf-accessibility/${conversionId}`);

  const editModeBtn = page.getByTestId("button-edit-mode");
  await expect(editModeBtn).toBeVisible({ timeout: 15_000 });
  await editModeBtn.click();

  const editor = page.getByTestId("rich-text-editor-content");
  await expect(editor).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("RichTextEditor — link popover", () => {
  /**
   * Test 1: Insert flow.
   *
   * Clicking the link toolbar button when the cursor is on plain text (no
   * existing link) should open the popover without a "Current link" label.
   */
  test("clicking link button on plain-text selection opens popover with no 'Current link' label", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const conversionId = await seedConversionWithHtml(
      page,
      SEED_HTML_PLAIN,
      "plain-insert-test.pdf",
    );

    await openEditorForConversion(page, conversionId);

    // Click inside the editor content to place the cursor in plain text.
    const editor = page.getByTestId("rich-text-editor-content");
    await editor.click();

    // Click the link toolbar button to open the popover.
    const linkBtn = page.getByTestId("rte-toolbar-add-link");
    await expect(linkBtn).toBeVisible({ timeout: 5_000 });
    await linkBtn.click();

    // The URL input inside the popover should be visible.
    const urlInput = page.getByTestId("rte-link-url-input");
    await expect(urlInput).toBeVisible({ timeout: 5_000 });

    // The "Current link:" preview must NOT appear — there is no existing link.
    const currentUrlLabel = page.getByTestId("rte-link-current-url");
    await expect(currentUrlLabel).not.toBeVisible();
  });

  /**
   * Test 2: Edit existing link — "Current link" label is shown.
   *
   * When the cursor is inside an existing link and the user opens the popover,
   * the "Current link:" label must be visible and contain the link's href.
   */
  test("clicking link button inside an existing link shows 'Current link' label with correct href", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const conversionId = await seedConversionWithHtml(
      page,
      SEED_HTML_WITH_LINK,
      "link-edit-test.pdf",
    );

    await openEditorForConversion(page, conversionId);

    // Click on the anchor element inside the editor.
    const editorLink = page
      .getByTestId("rich-text-editor-content")
      .locator(`a[href="${EXISTING_LINK_HREF}"]`);
    await expect(editorLink).toBeVisible({ timeout: 5_000 });
    await editorLink.click();

    // Open the link popover.
    const linkBtn = page.getByTestId("rte-toolbar-add-link");
    await linkBtn.click();

    // The popover's URL input should be visible.
    const urlInput = page.getByTestId("rte-link-url-input");
    await expect(urlInput).toBeVisible({ timeout: 5_000 });

    // The "Current link:" preview must appear and display the existing href.
    const currentUrlLabel = page.getByTestId("rte-link-current-url");
    await expect(currentUrlLabel).toBeVisible({ timeout: 5_000 });
    await expect(currentUrlLabel).toContainText(EXISTING_LINK_HREF);
  });

  /**
   * Test 3: Edit URL and confirm.
   *
   * Clearing the URL input, typing a new URL, and clicking Confirm should
   * update the href of the link in the editor.
   */
  test("editing the URL and confirming updates the link href in the editor", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const conversionId = await seedConversionWithHtml(
      page,
      SEED_HTML_WITH_LINK,
      "link-confirm-test.pdf",
    );

    await openEditorForConversion(page, conversionId);

    // Click the existing link to place the cursor inside it.
    const editorLink = page
      .getByTestId("rich-text-editor-content")
      .locator(`a[href="${EXISTING_LINK_HREF}"]`);
    await expect(editorLink).toBeVisible({ timeout: 5_000 });
    await editorLink.click();

    // Open the link popover.
    const linkBtn = page.getByTestId("rte-toolbar-add-link");
    await linkBtn.click();

    // Type the new URL into the input field.
    const urlInput = page.getByTestId("rte-link-url-input");
    await expect(urlInput).toBeVisible({ timeout: 5_000 });
    await urlInput.fill(NEW_LINK_HREF);

    // Confirm the change.
    const confirmBtn = page.getByTestId("rte-link-confirm");
    await confirmBtn.click();

    // The popover should be dismissed.
    await expect(page.getByTestId("rte-link-url-input")).not.toBeVisible({
      timeout: 5_000,
    });

    // The link inside the editor should now carry the new href.
    const updatedLink = page
      .getByTestId("rich-text-editor-content")
      .locator(`a[href="${NEW_LINK_HREF}"]`);
    await expect(updatedLink).toBeVisible({ timeout: 5_000 });

    // The old href should no longer exist in the editor.
    const oldLink = page
      .getByTestId("rich-text-editor-content")
      .locator(`a[href="${EXISTING_LINK_HREF}"]`);
    await expect(oldLink).not.toBeVisible();
  });

  /**
   * Test 4: Remove link.
   *
   * Clicking "Remove link" inside the popover should strip the anchor mark
   * from the text while leaving the text itself intact.
   */
  test("clicking 'Remove link' removes the anchor mark from the text", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const conversionId = await seedConversionWithHtml(
      page,
      SEED_HTML_WITH_LINK,
      "link-remove-test.pdf",
    );

    await openEditorForConversion(page, conversionId);

    // Click the existing link to place the cursor inside it.
    const editorLink = page
      .getByTestId("rich-text-editor-content")
      .locator(`a[href="${EXISTING_LINK_HREF}"]`);
    await expect(editorLink).toBeVisible({ timeout: 5_000 });
    await editorLink.click();

    // Open the link popover.
    const linkBtn = page.getByTestId("rte-toolbar-add-link");
    await linkBtn.click();

    // The "Remove link" button is only rendered when a link is active.
    const removeLinkBtn = page.getByTestId("rte-link-remove");
    await expect(removeLinkBtn).toBeVisible({ timeout: 5_000 });
    await removeLinkBtn.click();

    // The popover should be dismissed.
    await expect(page.getByTestId("rte-link-url-input")).not.toBeVisible({
      timeout: 5_000,
    });

    // The anchor element must no longer exist in the editor.
    const removedLink = page
      .getByTestId("rich-text-editor-content")
      .locator(`a[href="${EXISTING_LINK_HREF}"]`);
    await expect(removedLink).not.toBeVisible({ timeout: 5_000 });

    // The link text must still be present as plain text.
    await expect(
      page.getByTestId("rich-text-editor-content").getByText("our site"),
    ).toBeVisible({ timeout: 5_000 });
  });
});
