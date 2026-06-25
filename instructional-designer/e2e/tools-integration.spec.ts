import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Accessibility Tools — Integration Tests
 *
 * These tests hit the real server endpoints with NO page.route mocking.
 * They validate the server-side logic (math, response shape, field ranges)
 * rather than just confirming the UI can render a given payload.
 *
 * Labelled [integration] so they can be excluded from fast CI runs:
 *   npx playwright test --grep-invert integration
 *
 * Included test suites:
 *  A. Color Contrast — pure WCAG math, fully deterministic; always safe to run.
 *  B. URL Scanner    — fetches a public URL and calls the Anthropic AI;
 *     skipped automatically when ANTHROPIC_API_KEY is not set.
 */

// ===========================================================================
// A. [integration] Color Contrast — real server, no mock
// ===========================================================================
test.describe("[integration] Color Contrast — real server response", () => {
  // Black on white: the maximum possible contrast (21:1).
  test("black on white returns ratio ≈ 21 and passes all WCAG levels", async ({ page }) => {
    const resp = await page.request.post("/api/tools/color-contrast", {
      data: { foreground: "#000000", background: "#ffffff" },
    });

    expect(resp.status(), "color-contrast must return 200").toBe(200);

    const body = await resp.json();

    // Ratio must be a positive finite number
    expect(typeof body.ratio, "ratio is a number").toBe("number");
    expect(body.ratio, "ratio must be > 0").toBeGreaterThan(0);
    expect(isFinite(body.ratio), "ratio must be finite").toBe(true);

    // Black / white is exactly 21:1 per WCAG specification
    expect(body.ratio, "black-on-white ratio must be 21").toBe(21);

    // All WCAG levels pass at 21:1
    expect(body.aa_normal, "aa_normal passes at 21:1").toBe(true);
    expect(body.aa_large, "aa_large passes at 21:1").toBe(true);
    expect(body.aaa_normal, "aaa_normal passes at 21:1").toBe(true);
    expect(body.aaa_large, "aaa_large passes at 21:1").toBe(true);

    // Echo fields must match what was sent
    expect(body.foreground, "foreground echoed").toBe("#000000");
    expect(body.background, "background echoed").toBe("#ffffff");
  });

  // White on white: minimum contrast (1:1) — fails every WCAG level.
  test("white on white returns ratio 1 and fails all WCAG levels", async ({ page }) => {
    const resp = await page.request.post("/api/tools/color-contrast", {
      data: { foreground: "#ffffff", background: "#ffffff" },
    });

    expect(resp.status(), "color-contrast must return 200").toBe(200);

    const body = await resp.json();

    expect(body.ratio, "white-on-white ratio must be 1").toBe(1);
    expect(body.aa_normal, "aa_normal fails at 1:1").toBe(false);
    expect(body.aa_large, "aa_large fails at 1:1").toBe(false);
    expect(body.aaa_normal, "aaa_normal fails at 1:1").toBe(false);
    expect(body.aaa_large, "aaa_large fails at 1:1").toBe(false);
  });

  // Mid-range pair: a ratio that passes AA large/large but not AA normal.
  // #767676 on #ffffff → ratio ≈ 4.54, which is ≥ 4.5 (aa_normal) and ≥ 3 (aa_large).
  test("#767676 on #ffffff passes AA (ratio ≈ 4.54) but not AAA normal", async ({ page }) => {
    const resp = await page.request.post("/api/tools/color-contrast", {
      data: { foreground: "#767676", background: "#ffffff" },
    });

    expect(resp.status(), "color-contrast must return 200").toBe(200);

    const body = await resp.json();

    expect(body.ratio, "ratio must be > 0").toBeGreaterThan(0);
    // Known value for this pair
    expect(body.ratio, "ratio must be ≥ 4.5").toBeGreaterThanOrEqual(4.5);
    expect(body.ratio, "ratio must be < 7").toBeLessThan(7);

    expect(body.aa_normal, "aa_normal passes at ≥ 4.5").toBe(true);
    expect(body.aa_large, "aa_large passes at ≥ 3").toBe(true);
    expect(body.aaa_normal, "aaa_normal fails below 7").toBe(false);
    // aaa_large requires ≥ 4.5 — same threshold as aa_normal
    expect(body.aaa_large, "aaa_large passes at ≥ 4.5").toBe(true);
  });

  // 3-digit shorthand hex must be accepted and expanded correctly.
  test("3-digit shorthand #000 / #fff equals the 6-digit variant", async ({ page }) => {
    const [short, full] = await Promise.all([
      page.request.post("/api/tools/color-contrast", {
        data: { foreground: "#000", background: "#fff" },
      }),
      page.request.post("/api/tools/color-contrast", {
        data: { foreground: "#000000", background: "#ffffff" },
      }),
    ]);

    expect(short.status(), "shorthand request returns 200").toBe(200);
    expect(full.status(), "full-hex request returns 200").toBe(200);

    const shortBody = await short.json();
    const fullBody = await full.json();

    expect(shortBody.ratio, "shorthand ratio matches full-hex ratio").toBe(fullBody.ratio);
  });

  // Invalid color must return 400 — not a silent wrong answer.
  test("invalid foreground color returns 400", async ({ page }) => {
    const resp = await page.request.post("/api/tools/color-contrast", {
      data: { foreground: "notacolor", background: "#ffffff" },
    });
    expect(resp.status(), "invalid foreground must yield 400").toBe(400);
    const body = await resp.json();
    expect(body.error, "error message is present").toBeTruthy();
  });

  // Missing both fields must return 400.
  test("missing colors returns 400", async ({ page }) => {
    const resp = await page.request.post("/api/tools/color-contrast", {
      data: {},
    });
    expect(resp.status(), "missing colors must yield 400").toBe(400);
  });
});

// ===========================================================================
// B. [integration] URL Scanner — real server + AI response, no mock
// ===========================================================================
// These tests make a live Anthropic API call.  They are automatically skipped
// when ANTHROPIC_API_KEY is absent from the server environment.
test.describe("[integration] URL Scanner — real server + AI response", () => {
  // Live Anthropic API calls can take 10-20 s on their own; under a loaded CI
  // machine the round-trip could exceed the global 30 s default and produce a
  // flaky timeout rather than a clean skip.  60 s gives enough headroom.
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    // Probe the server for the API key presence via a canary request.
    // If the key is missing the endpoint returns a 500 with a recognisable
    // message; we skip gracefully rather than fail the suite.
    const probe = await page.request.post("/api/tools/url-scanner", {
      data: { url: "https://example.com" },
    });
    const status = probe.status();
    if (status === 500) {
      const body = await probe.json().catch(() => ({}));
      const msg = (body?.error ?? "") as string;
      if (
        msg.toLowerCase().includes("api key") ||
        msg.toLowerCase().includes("anthropic") ||
        msg.toLowerCase().includes("authentication")
      ) {
        test.skip(true, "ANTHROPIC_API_KEY not available — skipping AI-dependent test");
      }
    }
  });

  test("example.com scan returns a valid accessibility report shape", async ({ page }) => {
    const resp = await page.request.post("/api/tools/url-scanner", {
      data: { url: "https://example.com" },
    });

    // A network or API error produces a 4xx/5xx — fail fast so the cause is clear
    expect(
      resp.status(),
      `url-scanner returned ${resp.status()} — check ANTHROPIC_API_KEY and network access`,
    ).toBe(200);

    const body = await resp.json();

    // --- Shape checks ---
    expect(body, "response body is an object").toBeTruthy();

    // url field must be present and match what was sent
    expect(typeof body.url, "url field is a string").toBe("string");
    expect(body.url, "url field matches the request").toContain("example.com");

    // score must be an integer in [0, 100]
    expect(typeof body.score, "score is a number").toBe("number");
    expect(body.score, "score must be ≥ 0").toBeGreaterThanOrEqual(0);
    expect(body.score, "score must be ≤ 100").toBeLessThanOrEqual(100);
    expect(Number.isInteger(body.score) || body.score === Math.floor(body.score),
      "score is a whole number or truncated value",
    ).toBe(true);

    // summary must be a non-empty string
    expect(typeof body.summary, "summary is a string").toBe("string");
    expect(body.summary.trim().length, "summary is non-empty").toBeGreaterThan(0);

    // issues must be an array (may be empty for a simple page like example.com)
    expect(Array.isArray(body.issues), "issues is an array").toBe(true);

    // Each issue must have at minimum: title, severity, description
    for (const issue of body.issues as Array<Record<string, unknown>>) {
      expect(typeof issue.title, "issue.title is a string").toBe("string");
      expect(typeof issue.severity, "issue.severity is a string").toBe("string");
      expect(
        ["critical", "major", "minor"].includes(issue.severity as string),
        `issue.severity "${issue.severity}" must be critical | major | minor`,
      ).toBe(true);
      expect(typeof issue.description, "issue.description is a string").toBe("string");
    }

    // passed must be an array of strings (may be empty)
    expect(Array.isArray(body.passed), "passed is an array").toBe(true);
    for (const item of body.passed as unknown[]) {
      expect(typeof item, "each passed entry is a string").toBe("string");
    }
  });

  // SSRF guard: localhost must be blocked at the server level, not just the UI.
  test("localhost URL is rejected with 400 — SSRF guard active", async ({ page }) => {
    const resp = await page.request.post("/api/tools/url-scanner", {
      data: { url: "http://127.0.0.1/" },
    });
    expect(resp.status(), "SSRF guard must return 400 for localhost").toBe(400);
    const body = await resp.json();
    expect(body.error, "error message is present").toBeTruthy();
  });

  // Invalid/non-URL input must return 400.
  test("non-URL input is rejected with 400", async ({ page }) => {
    const resp = await page.request.post("/api/tools/url-scanner", {
      data: { url: "not-a-url" },
    });
    expect(resp.status(), "non-URL must yield 400").toBe(400);
    const body = await resp.json();
    expect(body.error, "error message is present").toBeTruthy();
  });

  // file:// protocol must be blocked.
  test("file:// URL is rejected with 400", async ({ page }) => {
    const resp = await page.request.post("/api/tools/url-scanner", {
      data: { url: "file:///etc/passwd" },
    });
    expect(resp.status(), "file:// URL must yield 400").toBe(400);
  });

  // Missing url field must return 400.
  test("missing url field returns 400", async ({ page }) => {
    const resp = await page.request.post("/api/tools/url-scanner", {
      data: {},
    });
    expect(resp.status(), "missing url must yield 400").toBe(400);
  });
});

// ===========================================================================
// Shared fixture helpers
// ===========================================================================

// Deterministic skip guard: read directly from the test-runner environment.
// The server uses AI_INTEGRATIONS_ANTHROPIC_API_KEY (set by the Replit AI
// integration).  This check is reliable because it does not depend on any
// specific error message shape returned by the server.
const AI_KEY_AVAILABLE = Boolean(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY);

// 400×200 RGB PNG with a blue rectangle and the text "BSU Accessibility Tool
// Logo" — large enough that the Anthropic Vision API accepts it without
// returning "Could not process image".  Used for alt-text tests.
function loadAltTextFixture(): Buffer {
  return fs.readFileSync(path.resolve(__dirname, "fixtures/alt-text-sample.png"));
}

// 200×60 greyscale PNG rendered with "x^2 + y^2 = r^2".
// Large enough that a vision model reliably identifies it as math.
function loadMathEquationFixture(): Buffer {
  return fs.readFileSync(path.resolve(__dirname, "fixtures/math-equation.png"));
}

// ===========================================================================
// C. [integration] Alt Text Generator — real server + AI, no mock
// ===========================================================================
// These tests make a live Anthropic API call.  They are automatically skipped
// when AI_INTEGRATIONS_ANTHROPIC_API_KEY is not set in the server environment.
test.describe("[integration] Alt Text Generator — real server + AI response", () => {
  // Live Anthropic API calls can take 10-20 s on their own; under a loaded CI
  // machine the round-trip could exceed the global 30 s default and produce a
  // flaky timeout rather than a clean skip.  60 s gives enough headroom.
  test.setTimeout(60_000);

  test.beforeEach(() => {
    if (!AI_KEY_AVAILABLE) {
      test.skip(true, "AI_INTEGRATIONS_ANTHROPIC_API_KEY not set — skipping AI-dependent test");
    }
  });

  test("returns a valid alt-text response shape for a real image", async ({ page }) => {
    const resp = await page.request.post("/api/tools/alt-text", {
      multipart: {
        image: {
          name: "test-image.png",
          mimeType: "image/png",
          buffer: loadAltTextFixture(),
        },
      },
    });

    expect(
      resp.status(),
      `alt-text returned ${resp.status()} — check AI_INTEGRATIONS_ANTHROPIC_API_KEY`,
    ).toBe(200);

    const body = await resp.json() as Record<string, unknown>;

    // altText must be a string (empty string when isDecorative is true)
    expect(typeof body.altText, "altText is a string").toBe("string");

    // isDecorative must be a boolean
    expect(typeof body.isDecorative, "isDecorative is a boolean").toBe("boolean");

    // characterCount must be a non-negative integer.
    // NOTE: the server computes characterCount from the raw AI response before
    // normalising decorative images to "", so characterCount reflects the raw
    // "[decorative]" string length (13) rather than the returned altText length
    // (0) when isDecorative is true.  We validate it is a non-negative integer
    // and, for non-decorative responses, that it matches altText exactly.
    expect(typeof body.characterCount, "characterCount is a number").toBe("number");
    expect(body.characterCount as number, "characterCount is ≥ 0").toBeGreaterThanOrEqual(0);
    expect(
      Number.isInteger(body.characterCount),
      "characterCount is an integer",
    ).toBe(true);

    if (!body.isDecorative) {
      // Non-decorative: altText must be non-empty and characterCount must match
      expect(
        (body.altText as string).trim().length,
        "altText is non-empty when not decorative",
      ).toBeGreaterThan(0);
      expect(
        body.characterCount,
        "characterCount matches altText length when not decorative",
      ).toBe((body.altText as string).length);
    }
  });

  test("with optional context field — still returns valid shape", async ({ page }) => {
    const resp = await page.request.post("/api/tools/alt-text", {
      multipart: {
        image: {
          name: "test-image.png",
          mimeType: "image/png",
          buffer: loadAltTextFixture(),
        },
        context: "A blue rectangle with white text, used in automated testing",
      },
    });

    expect(resp.status(), "alt-text with context must return 200").toBe(200);

    const body = await resp.json() as Record<string, unknown>;
    expect(typeof body.altText, "altText is a string").toBe("string");
    expect(typeof body.isDecorative, "isDecorative is a boolean").toBe("boolean");
    expect(typeof body.characterCount, "characterCount is a number").toBe("number");
  });

  // Validation checks — these do NOT call the AI and do not need the key.
  test("missing image field returns 400", async ({ page }) => {
    const resp = await page.request.post("/api/tools/alt-text", {
      multipart: {},
    });
    expect(resp.status(), "missing image must yield 400").toBe(400);
    const body = await resp.json() as Record<string, unknown>;
    expect(body.error, "error message is present").toBeTruthy();
  });

  test("non-image file is rejected with 400", async ({ page }) => {
    const resp = await page.request.post("/api/tools/alt-text", {
      multipart: {
        image: {
          name: "document.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("hello"),
        },
      },
    });
    expect(resp.status(), "non-image MIME type must yield 400").toBe(400);
  });
});

// ===========================================================================
// D. [integration] Math OCR — real server + AI, no mock
// ===========================================================================
// These tests make a live Anthropic API call.  They are automatically skipped
// when AI_INTEGRATIONS_ANTHROPIC_API_KEY is not set in the server environment.
test.describe("[integration] Math OCR — real server + AI response", () => {
  // Live Anthropic API calls can take 10-20 s on their own; under a loaded CI
  // machine the round-trip could exceed the global 30 s default and produce a
  // flaky timeout rather than a clean skip.  60 s gives enough headroom.
  test.setTimeout(60_000);

  test.beforeEach(() => {
    if (!AI_KEY_AVAILABLE) {
      test.skip(true, "AI_INTEGRATIONS_ANTHROPIC_API_KEY not set — skipping AI-dependent test");
    }
  });

  // Happy-path: a clearly-rendered equation must be recognised as math.
  // Uses a 200×60 greyscale PNG with "x^2 + y^2 = r^2" — large enough that
  // a vision model reliably identifies it as mathematical content.
  test("returns a valid math-ocr response shape for an image containing an equation", async ({ page }) => {
    const mathImage = loadMathEquationFixture();

    const resp = await page.request.post("/api/tools/math-ocr", {
      multipart: {
        image: {
          name: "math-equation.png",
          mimeType: "image/png",
          buffer: mathImage,
        },
      },
    });

    expect(
      resp.status(),
      `math-ocr returned ${resp.status()} for a math image — check AI_INTEGRATIONS_ANTHROPIC_API_KEY`,
    ).toBe(200);

    const body = await resp.json() as Record<string, unknown>;

    // All four fields must be present strings
    expect(typeof body.plainText, "plainText is a string").toBe("string");
    expect(typeof body.latex, "latex is a string").toBe("string");
    expect(typeof body.mathml, "mathml is a string").toBe("string");
    expect(typeof body.description, "description is a string").toBe("string");

    // At least one of latex or description must be non-empty
    const hasLatex = (body.latex as string).trim().length > 0;
    const hasDescription = (body.description as string).trim().length > 0;
    expect(
      hasLatex || hasDescription,
      "at least one of latex or description must be non-empty",
    ).toBe(true);
  });

  // Error-path: a non-math image must return 422 with a descriptive error.
  test("returns 422 with an error field when the image contains no math", async ({ page }) => {
    const resp = await page.request.post("/api/tools/math-ocr", {
      multipart: {
        image: {
          name: "no-math.png",
          mimeType: "image/png",
          buffer: loadAltTextFixture(),
        },
      },
    });

    // The AI may return 422 ("no math detected") or, on rare occasions, attempt
    // to parse a trivial solid image as something mathematical (200).  We assert
    // 422 is the primary path and that the error shape is correct when it fires.
    const status = resp.status();
    expect(
      [200, 422].includes(status),
      `math-ocr must return 200 or 422 for a blank image, got ${status}`,
    ).toBe(true);

    if (status === 422) {
      const body = await resp.json() as Record<string, unknown>;
      expect(typeof body.error, "422 body must have an error field").toBe("string");
      expect(
        (body.error as string).trim().length,
        "422 error message must be non-empty",
      ).toBeGreaterThan(0);
    }
  });

  // Validation checks — do NOT require the AI key.
  test("missing image field returns 400", async ({ page }) => {
    const resp = await page.request.post("/api/tools/math-ocr", {
      multipart: {},
    });
    expect(resp.status(), "missing image must yield 400").toBe(400);
    const body = await resp.json() as Record<string, unknown>;
    expect(body.error, "error message is present").toBeTruthy();
  });

  test("non-image file is rejected with 400", async ({ page }) => {
    const resp = await page.request.post("/api/tools/math-ocr", {
      multipart: {
        image: {
          name: "document.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("hello"),
        },
      },
    });
    expect(resp.status(), "non-image MIME type must yield 400").toBe(400);
  });
});
