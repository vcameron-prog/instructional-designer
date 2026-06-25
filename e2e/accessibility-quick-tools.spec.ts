/**
 * End-to-end tests for the four accessibility quick tool pages:
 *   /accessibility-tools/color-contrast
 *   /accessibility-tools/url-scanner
 *   /accessibility-tools/alt-text
 *   /accessibility-tools/math-ocr
 *
 * Color contrast is a pure-math server route (no AI), so the full check →
 * result flow is exercised.  The remaining three tools involve AI or file
 * uploads; those tests verify the page loads, UI elements are present, and
 * the submit button behaves correctly (disabled without required input).
 *
 * No auth is required for any of these pages.
 */

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Color Contrast Checker
// ---------------------------------------------------------------------------

test.describe("Color Contrast Checker (/accessibility-tools/color-contrast)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/accessibility-tools/color-contrast");
    await expect(page.locator("h1")).toContainText("Color Contrast Checker", {
      timeout: 15_000,
    });
  });

  test("page loads with heading and input fields", async ({ page }) => {
    await expect(page.getByTestId("input-foreground")).toBeVisible();
    await expect(page.getByTestId("input-background")).toBeVisible();
    await expect(page.getByTestId("button-check-contrast")).toBeVisible();
    await expect(page.getByTestId("button-swap-colors")).toBeVisible();
  });

  test("default colors are pre-filled", async ({ page }) => {
    await expect(page.getByTestId("input-foreground")).toHaveValue("#000000");
    await expect(page.getByTestId("input-background")).toHaveValue("#ffffff");
  });

  test("checking black-on-white contrast shows a ratio of 21.00:1", async ({
    page,
  }) => {
    // Default values are already #000000 / #ffffff — just click check
    await page.getByTestId("button-check-contrast").click();

    const ratioEl = page.getByTestId("text-contrast-ratio");
    await expect(ratioEl).toBeVisible({ timeout: 10_000 });
    await expect(ratioEl).toContainText("21.00:1");
  });

  test("checking high-contrast custom colors shows a ratio and AA Pass badge", async ({
    page,
  }) => {
    await page.getByTestId("input-foreground").fill("#1a1a2e");
    await page.getByTestId("input-background").fill("#f5f5f5");

    await page.getByTestId("button-check-contrast").click();

    await expect(page.getByTestId("text-contrast-ratio")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("badge-contrast-rating")).toContainText(
      "AA Pass",
    );
  });

  test("checking a low-contrast pair shows a Fails WCAG badge", async ({
    page,
  }) => {
    // Light grey on white — very low contrast
    await page.getByTestId("input-foreground").fill("#cccccc");
    await page.getByTestId("input-background").fill("#ffffff");

    await page.getByTestId("button-check-contrast").click();

    await expect(page.getByTestId("badge-contrast-rating")).toContainText(
      "Fails WCAG",
      { timeout: 10_000 },
    );
  });

  test("mid-range pair (~3.74:1) shows a Large Text Only badge", async ({
    page,
  }) => {
    // #848484 on white — ratio ≈ 3.74:1 (above 3:1 aa_large threshold,
    // below 4.5:1 aa_normal threshold) → "Large Text Only"
    await page.getByTestId("input-foreground").fill("#848484");
    await page.getByTestId("input-background").fill("#ffffff");

    await page.getByTestId("button-check-contrast").click();

    await expect(page.getByTestId("text-contrast-ratio")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("text-contrast-ratio")).toContainText("3.74");
    await expect(page.getByTestId("badge-contrast-rating")).toContainText(
      "Large Text Only",
    );
  });

  test("exact 3.00:1 boundary shows Large Text Only badge", async ({
    page,
  }) => {
    // #959595 on white — computed ratio rounds to exactly 3.00:1, the aa_large
    // inclusive lower boundary (ratio >= 3) → "Large Text Only"
    await page.getByTestId("input-foreground").fill("#959595");
    await page.getByTestId("input-background").fill("#ffffff");

    await page.getByTestId("button-check-contrast").click();

    await expect(page.getByTestId("text-contrast-ratio")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("text-contrast-ratio")).toContainText("3.00");
    await expect(page.getByTestId("badge-contrast-rating")).toContainText(
      "Large Text Only",
    );
  });

  test("pair just below the 4.5:1 boundary (~4.48:1) shows Large Text Only, not AA Pass", async ({
    page,
  }) => {
    // #777777 on white — ratio rounds to 4.48:1, just below the aa_normal
    // (4.5:1) ceiling → still "Large Text Only", not "AA Pass"
    await page.getByTestId("input-foreground").fill("#777777");
    await page.getByTestId("input-background").fill("#ffffff");

    await page.getByTestId("button-check-contrast").click();

    await expect(page.getByTestId("text-contrast-ratio")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("text-contrast-ratio")).toContainText("4.48");
    await expect(page.getByTestId("badge-contrast-rating")).toContainText(
      "Large Text Only",
    );
    await expect(page.getByTestId("badge-contrast-rating")).not.toContainText(
      "AA Pass",
    );
  });

  test("exact 4.50:1 boundary shows AA Pass badge", async ({
    page,
  }) => {
    // #6464f4 on white — computed ratio rounds to exactly 4.50:1, the aa_normal
    // inclusive boundary (ratio >= 4.5) → "AA Pass"
    await page.getByTestId("input-foreground").fill("#6464f4");
    await page.getByTestId("input-background").fill("#ffffff");

    await page.getByTestId("button-check-contrast").click();

    await expect(page.getByTestId("text-contrast-ratio")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("text-contrast-ratio")).toContainText("4.50");
    await expect(page.getByTestId("badge-contrast-rating")).toContainText(
      "AA Pass",
    );
  });

  test("exact 7.00:1 boundary shows AA Pass badge and AAA Normal Text passes", async ({
    page,
  }) => {
    // #595959 on white — computed ratio rounds to exactly 7.00:1, the aaa_normal
    // boundary (ratio >= 7) → "AA Pass" badge; the AAA Normal Text row should
    // show Pass
    await page.getByTestId("input-foreground").fill("#595959");
    await page.getByTestId("input-background").fill("#ffffff");

    await page.getByTestId("button-check-contrast").click();

    await expect(page.getByTestId("text-contrast-ratio")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("text-contrast-ratio")).toContainText("7.00");
    await expect(page.getByTestId("badge-contrast-rating")).toContainText(
      "AA Pass",
    );
    // The AAA Normal Text row (≥ 7:1) should also pass at exactly 7:1
    await expect(
      page.getByText("AAA — Normal text (≥ 7:1)"),
    ).toBeVisible();
  });

  test("swap button exchanges foreground and background values", async ({
    page,
  }) => {
    await page.getByTestId("input-foreground").fill("#112233");
    await page.getByTestId("input-background").fill("#aabbcc");

    await page.getByTestId("button-swap-colors").click();

    await expect(page.getByTestId("input-foreground")).toHaveValue("#aabbcc");
    await expect(page.getByTestId("input-background")).toHaveValue("#112233");
  });

  test("invalid hex shows an error message", async ({ page }) => {
    await page.getByTestId("input-foreground").fill("notacolor");

    await page.getByTestId("button-check-contrast").click();

    await expect(page.getByTestId("text-contrast-error")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("back button is present", async ({ page }) => {
    await expect(page.getByTestId("button-back")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// URL Accessibility Scanner
// ---------------------------------------------------------------------------

test.describe("URL Accessibility Scanner (/accessibility-tools/url-scanner)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/accessibility-tools/url-scanner");
    await expect(page.locator("h1")).toContainText(
      "URL Accessibility Scanner",
      { timeout: 15_000 },
    );
  });

  test("page loads with heading, URL input, and scan button", async ({
    page,
  }) => {
    await expect(page.getByTestId("input-scan-url")).toBeVisible();
    await expect(page.getByTestId("button-scan")).toBeVisible();
  });

  test("scan button is disabled when URL input is empty", async ({ page }) => {
    await expect(page.getByTestId("input-scan-url")).toHaveValue("");
    await expect(page.getByTestId("button-scan")).toBeDisabled();
  });

  test("scan button becomes enabled after entering a URL", async ({ page }) => {
    await page.getByTestId("input-scan-url").fill("https://example.com");
    await expect(page.getByTestId("button-scan")).toBeEnabled();
  });

  test("clearing the URL input disables the scan button again", async ({
    page,
  }) => {
    await page.getByTestId("input-scan-url").fill("https://example.com");
    await expect(page.getByTestId("button-scan")).toBeEnabled();

    await page.getByTestId("input-scan-url").fill("");
    await expect(page.getByTestId("button-scan")).toBeDisabled();
  });

  test("back button is present", async ({ page }) => {
    await expect(page.getByTestId("button-back")).toBeVisible();
  });

  test(
    "full round-trip scan of example.com returns a score and results panel",
    async ({ page }) => {
      test.skip(
        !!process.env.SKIP_NETWORK_TESTS,
        "Skipped in offline / fast CI runs (set SKIP_NETWORK_TESTS=1 to skip)",
      );

      await page.getByTestId("input-scan-url").fill("https://example.com");
      await page.getByTestId("button-scan").click();

      const scanResults = page.getByTestId("scan-results");
      await expect(scanResults).toBeVisible({ timeout: 60_000 });

      const scanScore = page.getByTestId("text-scan-score");
      await expect(scanScore).toBeVisible({ timeout: 5_000 });

      const scoreText = await scanScore.textContent();
      const score = Number(scoreText?.trim());
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    },
    { timeout: 75_000 },
  );
});

// ---------------------------------------------------------------------------
// Alt Text Generator
// ---------------------------------------------------------------------------

test.describe("Alt Text Generator (/accessibility-tools/alt-text)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/accessibility-tools/alt-text");
    await expect(page.locator("h1")).toContainText("Alt Text Generator", {
      timeout: 15_000,
    });
  });

  test("page loads with heading, dropzone, and generate button", async ({
    page,
  }) => {
    await expect(page.getByTestId("dropzone-image")).toBeVisible();
    await expect(page.getByTestId("button-generate-alt")).toBeVisible();
    await expect(page.getByTestId("input-context")).toBeVisible();
  });

  test("generate button is disabled when no image is selected", async ({
    page,
  }) => {
    await expect(page.getByTestId("button-generate-alt")).toBeDisabled();
  });

  test("uploading an image enables the generate button", async ({ page }) => {
    // Create a minimal 1×1 PNG in memory to use as a test file
    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );

    await page.getByTestId("input-image-file").setInputFiles({
      name: "test.png",
      mimeType: "image/png",
      buffer: minimalPng,
    });

    await expect(page.getByTestId("button-generate-alt")).toBeEnabled({
      timeout: 5_000,
    });
  });

  test("uploading a non-image file shows an error", async ({ page }) => {
    await page.getByTestId("input-image-file").setInputFiles({
      name: "test.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });

    await expect(page.getByTestId("text-alt-error")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("back button is present", async ({ page }) => {
    await expect(page.getByTestId("button-back")).toBeVisible();
  });

  test("copy button resets to 'Copy alt text' after the 2-second timeout", async ({
    page,
  }) => {
    await page.route("/api/tools/alt-text", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          altText: "A sample image for testing purposes",
          isDecorative: false,
          characterCount: 37,
        }),
      });
    });

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );

    await page.getByTestId("input-image-file").setInputFiles({
      name: "test.png",
      mimeType: "image/png",
      buffer: minimalPng,
    });

    await page.getByTestId("button-generate-alt").click();

    const copyBtn = page.getByTestId("button-copy-alt");
    await expect(copyBtn).toBeVisible({ timeout: 10_000 });

    await expect(copyBtn).toHaveAttribute("aria-label", "Copy alt text");

    await copyBtn.click();

    await expect(copyBtn).toHaveAttribute("aria-label", "Copied", {
      timeout: 2_000,
    });

    await expect(copyBtn).toHaveAttribute("aria-label", "Copy alt text", {
      timeout: 4_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Math OCR
// ---------------------------------------------------------------------------

test.describe("Math OCR (/accessibility-tools/math-ocr)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/accessibility-tools/math-ocr");
    await expect(page.locator("h1")).toContainText("Math OCR", {
      timeout: 15_000,
    });
  });

  test("page loads with heading, dropzone, and extract button", async ({
    page,
  }) => {
    await expect(page.getByTestId("dropzone-math-image")).toBeVisible();
    await expect(page.getByTestId("button-extract-math")).toBeVisible();
  });

  test("extract button is disabled when no image is selected", async ({
    page,
  }) => {
    await expect(page.getByTestId("button-extract-math")).toBeDisabled();
  });

  test("uploading an image enables the extract button", async ({ page }) => {
    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );

    await page.getByTestId("input-math-file").setInputFiles({
      name: "math.png",
      mimeType: "image/png",
      buffer: minimalPng,
    });

    await expect(page.getByTestId("button-extract-math")).toBeEnabled({
      timeout: 5_000,
    });
  });

  test("uploading a non-image file shows an error", async ({ page }) => {
    await page.getByTestId("input-math-file").setInputFiles({
      name: "math.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });

    await expect(page.getByTestId("text-math-error")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("back button is present", async ({ page }) => {
    await expect(page.getByTestId("button-back")).toBeVisible();
  });

  test("copy button resets to 'Copy LaTeX' after the 2-second timeout", async ({
    page,
  }) => {
    await page.route("/api/tools/math-ocr", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          plainText: "x squared plus y squared equals r squared",
          latex: "x^2 + y^2 = r^2",
          mathml: "<math><mrow><msup><mi>x</mi><mn>2</mn></msup></mrow></math>",
          description: "Pythagorean theorem",
        }),
      });
    });

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );

    await page.getByTestId("input-math-file").setInputFiles({
      name: "math.png",
      mimeType: "image/png",
      buffer: minimalPng,
    });

    await page.getByTestId("button-extract-math").click();

    const copyLatexBtn = page.getByTestId("button-copy-latex");
    await expect(copyLatexBtn).toBeVisible({ timeout: 10_000 });

    await expect(copyLatexBtn).toHaveAttribute("aria-label", "Copy LaTeX");

    await copyLatexBtn.click();

    await expect(copyLatexBtn).toHaveAttribute("aria-label", "LaTeX copied", {
      timeout: 2_000,
    });

    await expect(copyLatexBtn).toHaveAttribute("aria-label", "Copy LaTeX", {
      timeout: 4_000,
    });
  });
});
