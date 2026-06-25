# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tools-integration.spec.ts >> [integration] Alt Text Generator — real server + AI response >> non-image file is rejected with 400
- Location: instructional-designer/e2e/tools-integration.spec.ts:379:3

# Error details

```
Error: non-image MIME type must yield 400

expect(received).toBe(expected) // Object.is equality

Expected: 400
Received: 500
```

# Test source

```ts
  289 |   // machine the round-trip could exceed the global 30 s default and produce a
  290 |   // flaky timeout rather than a clean skip.  60 s gives enough headroom.
  291 |   test.setTimeout(60_000);
  292 | 
  293 |   test.beforeEach(() => {
  294 |     if (!AI_KEY_AVAILABLE) {
  295 |       test.skip(true, "AI_INTEGRATIONS_ANTHROPIC_API_KEY not set — skipping AI-dependent test");
  296 |     }
  297 |   });
  298 | 
  299 |   test("returns a valid alt-text response shape for a real image", async ({ page }) => {
  300 |     const resp = await page.request.post("/api/tools/alt-text", {
  301 |       multipart: {
  302 |         image: {
  303 |           name: "test-image.png",
  304 |           mimeType: "image/png",
  305 |           buffer: loadAltTextFixture(),
  306 |         },
  307 |       },
  308 |     });
  309 | 
  310 |     expect(
  311 |       resp.status(),
  312 |       `alt-text returned ${resp.status()} — check AI_INTEGRATIONS_ANTHROPIC_API_KEY`,
  313 |     ).toBe(200);
  314 | 
  315 |     const body = await resp.json() as Record<string, unknown>;
  316 | 
  317 |     // altText must be a string (empty string when isDecorative is true)
  318 |     expect(typeof body.altText, "altText is a string").toBe("string");
  319 | 
  320 |     // isDecorative must be a boolean
  321 |     expect(typeof body.isDecorative, "isDecorative is a boolean").toBe("boolean");
  322 | 
  323 |     // characterCount must be a non-negative integer.
  324 |     // NOTE: the server computes characterCount from the raw AI response before
  325 |     // normalising decorative images to "", so characterCount reflects the raw
  326 |     // "[decorative]" string length (13) rather than the returned altText length
  327 |     // (0) when isDecorative is true.  We validate it is a non-negative integer
  328 |     // and, for non-decorative responses, that it matches altText exactly.
  329 |     expect(typeof body.characterCount, "characterCount is a number").toBe("number");
  330 |     expect(body.characterCount as number, "characterCount is ≥ 0").toBeGreaterThanOrEqual(0);
  331 |     expect(
  332 |       Number.isInteger(body.characterCount),
  333 |       "characterCount is an integer",
  334 |     ).toBe(true);
  335 | 
  336 |     if (!body.isDecorative) {
  337 |       // Non-decorative: altText must be non-empty and characterCount must match
  338 |       expect(
  339 |         (body.altText as string).trim().length,
  340 |         "altText is non-empty when not decorative",
  341 |       ).toBeGreaterThan(0);
  342 |       expect(
  343 |         body.characterCount,
  344 |         "characterCount matches altText length when not decorative",
  345 |       ).toBe((body.altText as string).length);
  346 |     }
  347 |   });
  348 | 
  349 |   test("with optional context field — still returns valid shape", async ({ page }) => {
  350 |     const resp = await page.request.post("/api/tools/alt-text", {
  351 |       multipart: {
  352 |         image: {
  353 |           name: "test-image.png",
  354 |           mimeType: "image/png",
  355 |           buffer: loadAltTextFixture(),
  356 |         },
  357 |         context: "A blue rectangle with white text, used in automated testing",
  358 |       },
  359 |     });
  360 | 
  361 |     expect(resp.status(), "alt-text with context must return 200").toBe(200);
  362 | 
  363 |     const body = await resp.json() as Record<string, unknown>;
  364 |     expect(typeof body.altText, "altText is a string").toBe("string");
  365 |     expect(typeof body.isDecorative, "isDecorative is a boolean").toBe("boolean");
  366 |     expect(typeof body.characterCount, "characterCount is a number").toBe("number");
  367 |   });
  368 | 
  369 |   // Validation checks — these do NOT call the AI and do not need the key.
  370 |   test("missing image field returns 400", async ({ page }) => {
  371 |     const resp = await page.request.post("/api/tools/alt-text", {
  372 |       multipart: {},
  373 |     });
  374 |     expect(resp.status(), "missing image must yield 400").toBe(400);
  375 |     const body = await resp.json() as Record<string, unknown>;
  376 |     expect(body.error, "error message is present").toBeTruthy();
  377 |   });
  378 | 
  379 |   test("non-image file is rejected with 400", async ({ page }) => {
  380 |     const resp = await page.request.post("/api/tools/alt-text", {
  381 |       multipart: {
  382 |         image: {
  383 |           name: "document.txt",
  384 |           mimeType: "text/plain",
  385 |           buffer: Buffer.from("hello"),
  386 |         },
  387 |       },
  388 |     });
> 389 |     expect(resp.status(), "non-image MIME type must yield 400").toBe(400);
      |                                                                 ^ Error: non-image MIME type must yield 400
  390 |   });
  391 | });
  392 | 
  393 | // ===========================================================================
  394 | // D. [integration] Math OCR — real server + AI, no mock
  395 | // ===========================================================================
  396 | // These tests make a live Anthropic API call.  They are automatically skipped
  397 | // when AI_INTEGRATIONS_ANTHROPIC_API_KEY is not set in the server environment.
  398 | test.describe("[integration] Math OCR — real server + AI response", () => {
  399 |   // Live Anthropic API calls can take 10-20 s on their own; under a loaded CI
  400 |   // machine the round-trip could exceed the global 30 s default and produce a
  401 |   // flaky timeout rather than a clean skip.  60 s gives enough headroom.
  402 |   test.setTimeout(60_000);
  403 | 
  404 |   test.beforeEach(() => {
  405 |     if (!AI_KEY_AVAILABLE) {
  406 |       test.skip(true, "AI_INTEGRATIONS_ANTHROPIC_API_KEY not set — skipping AI-dependent test");
  407 |     }
  408 |   });
  409 | 
  410 |   // Happy-path: a clearly-rendered equation must be recognised as math.
  411 |   // Uses a 200×60 greyscale PNG with "x^2 + y^2 = r^2" — large enough that
  412 |   // a vision model reliably identifies it as mathematical content.
  413 |   test("returns a valid math-ocr response shape for an image containing an equation", async ({ page }) => {
  414 |     const mathImage = loadMathEquationFixture();
  415 | 
  416 |     const resp = await page.request.post("/api/tools/math-ocr", {
  417 |       multipart: {
  418 |         image: {
  419 |           name: "math-equation.png",
  420 |           mimeType: "image/png",
  421 |           buffer: mathImage,
  422 |         },
  423 |       },
  424 |     });
  425 | 
  426 |     expect(
  427 |       resp.status(),
  428 |       `math-ocr returned ${resp.status()} for a math image — check AI_INTEGRATIONS_ANTHROPIC_API_KEY`,
  429 |     ).toBe(200);
  430 | 
  431 |     const body = await resp.json() as Record<string, unknown>;
  432 | 
  433 |     // All four fields must be present strings
  434 |     expect(typeof body.plainText, "plainText is a string").toBe("string");
  435 |     expect(typeof body.latex, "latex is a string").toBe("string");
  436 |     expect(typeof body.mathml, "mathml is a string").toBe("string");
  437 |     expect(typeof body.description, "description is a string").toBe("string");
  438 | 
  439 |     // At least one of latex or description must be non-empty
  440 |     const hasLatex = (body.latex as string).trim().length > 0;
  441 |     const hasDescription = (body.description as string).trim().length > 0;
  442 |     expect(
  443 |       hasLatex || hasDescription,
  444 |       "at least one of latex or description must be non-empty",
  445 |     ).toBe(true);
  446 |   });
  447 | 
  448 |   // Error-path: a non-math image must return 422 with a descriptive error.
  449 |   test("returns 422 with an error field when the image contains no math", async ({ page }) => {
  450 |     const resp = await page.request.post("/api/tools/math-ocr", {
  451 |       multipart: {
  452 |         image: {
  453 |           name: "no-math.png",
  454 |           mimeType: "image/png",
  455 |           buffer: loadAltTextFixture(),
  456 |         },
  457 |       },
  458 |     });
  459 | 
  460 |     // The AI may return 422 ("no math detected") or, on rare occasions, attempt
  461 |     // to parse a trivial solid image as something mathematical (200).  We assert
  462 |     // 422 is the primary path and that the error shape is correct when it fires.
  463 |     const status = resp.status();
  464 |     expect(
  465 |       [200, 422].includes(status),
  466 |       `math-ocr must return 200 or 422 for a blank image, got ${status}`,
  467 |     ).toBe(true);
  468 | 
  469 |     if (status === 422) {
  470 |       const body = await resp.json() as Record<string, unknown>;
  471 |       expect(typeof body.error, "422 body must have an error field").toBe("string");
  472 |       expect(
  473 |         (body.error as string).trim().length,
  474 |         "422 error message must be non-empty",
  475 |       ).toBeGreaterThan(0);
  476 |     }
  477 |   });
  478 | 
  479 |   // Validation checks — do NOT require the AI key.
  480 |   test("missing image field returns 400", async ({ page }) => {
  481 |     const resp = await page.request.post("/api/tools/math-ocr", {
  482 |       multipart: {},
  483 |     });
  484 |     expect(resp.status(), "missing image must yield 400").toBe(400);
  485 |     const body = await resp.json() as Record<string, unknown>;
  486 |     expect(body.error, "error message is present").toBeTruthy();
  487 |   });
  488 | 
  489 |   test("non-image file is rejected with 400", async ({ page }) => {
```