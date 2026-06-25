# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tools-integration.spec.ts >> [integration] Oversized image upload — 400 before AI call >> alt-text endpoint returns 400 for a >5 MB image
- Location: instructional-designer/e2e/tools-integration.spec.ts:516:3

# Error details

```
Error: oversized upload to /api/tools/alt-text must return 400, not 500

expect(received).toBe(expected) // Object.is equality

Expected: 400
Received: 413
```

# Test source

```ts
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
  490 |     const resp = await page.request.post("/api/tools/math-ocr", {
  491 |       multipart: {
  492 |         image: {
  493 |           name: "document.txt",
  494 |           mimeType: "text/plain",
  495 |           buffer: Buffer.from("hello"),
  496 |         },
  497 |       },
  498 |     });
  499 |     expect(resp.status(), "non-image MIME type must yield 400").toBe(400);
  500 |   });
  501 | });
  502 | 
  503 | // ===========================================================================
  504 | // E. [integration] Oversized image upload — limit check fires before AI call
  505 | // ===========================================================================
  506 | // These tests confirm that multer's 5 MB fileSize limit rejects oversized
  507 | // uploads with 400 BEFORE the Anthropic API is ever invoked.
  508 | // They do NOT require an AI key and run in every environment.
  509 | test.describe("[integration] Oversized image upload — 400 before AI call", () => {
  510 |   // Produce a buffer just over 5 MB filled with zeros.  The exact content
  511 |   // does not matter — multer enforces the limit by counting stream bytes, not
  512 |   // by inspecting the image format.
  513 |   const FIVE_MB = 5 * 1024 * 1024;
  514 |   const oversizedBuffer = (): Buffer => Buffer.alloc(FIVE_MB + 1024, 0);
  515 | 
  516 |   test("alt-text endpoint returns 400 for a >5 MB image", async ({ page }) => {
  517 |     const resp = await page.request.post("/api/tools/alt-text", {
  518 |       multipart: {
  519 |         image: {
  520 |           name: "oversized.png",
  521 |           mimeType: "image/png",
  522 |           buffer: oversizedBuffer(),
  523 |         },
  524 |       },
  525 |     });
  526 | 
  527 |     // The ID server's multer callback catches LIMIT_FILE_SIZE and returns 400
  528 |     // before the Anthropic API is ever called.  A 5xx here would indicate the
  529 |     // error bypassed the limit check and reached the AI path.
  530 |     expect(
  531 |       resp.status(),
  532 |       "oversized upload to /api/tools/alt-text must return 400, not 500",
> 533 |     ).toBe(400);
      |       ^ Error: oversized upload to /api/tools/alt-text must return 400, not 500
  534 | 
  535 |     const body = await resp.json() as Record<string, unknown>;
  536 |     expect(typeof body.error, "error field must be a string").toBe("string");
  537 |     expect(
  538 |       (body.error as string).trim().length,
  539 |       "error message must be non-empty",
  540 |     ).toBeGreaterThan(0);
  541 |   });
  542 | 
  543 |   test("math-ocr endpoint returns 400 for a >5 MB image", async ({ page }) => {
  544 |     const resp = await page.request.post("/api/tools/math-ocr", {
  545 |       multipart: {
  546 |         image: {
  547 |           name: "oversized.png",
  548 |           mimeType: "image/png",
  549 |           buffer: oversizedBuffer(),
  550 |         },
  551 |       },
  552 |     });
  553 | 
  554 |     // The ID server's multer callback catches LIMIT_FILE_SIZE and returns 400
  555 |     // before the Anthropic API is ever called.  A 5xx here would indicate the
  556 |     // error bypassed the limit check and reached the AI path.
  557 |     expect(
  558 |       resp.status(),
  559 |       "oversized upload to /api/tools/math-ocr must return 400, not 500",
  560 |     ).toBe(400);
  561 | 
  562 |     const body = await resp.json() as Record<string, unknown>;
  563 |     expect(typeof body.error, "error field must be a string").toBe("string");
  564 |     expect(
  565 |       (body.error as string).trim().length,
  566 |       "error message must be non-empty",
  567 |     ).toBeGreaterThan(0);
  568 |   });
  569 | });
  570 | 
```