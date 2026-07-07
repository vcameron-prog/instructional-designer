---
name: PDF font-size metadata via pdf-parse internals
description: How to get per-line font size (heading signal) out of pdf-parse when its public API doesn't expose it.
---

`pdf-parse`'s public API (`getText`/`getInfo`/`getTable`/`getImage`/`getScreenshot`) never exposes per-text-item font size or style — there is no supported way to distinguish a heading from body text by rendered appearance through the documented surface.

The underlying pdf.js document is reachable via `(parser as any).doc` (a TS-`private` field with no runtime enforcement) once `getText()` or `getInfo()` has populated it. From there, `doc.getPage(n).getTextContent()` returns items with `.str`, `.height` (font-size proxy), and `.transform` (position), which can be grouped into lines by y-position and compared against the document's most common line height to flag actual headings.

**Why:** needed a real "is this a heading" signal instead of text-shape guessing (short/capitalized/no punctuation) for truncation-cutoff messaging; shape heuristics misfire on short factual sentences and all-caps disclaimers.

**How to apply:** treat this as a private-internals dependency, not a stable contract — wrap every step in try/catch and degrade to an empty result (falling back to the old shape heuristic) rather than throwing, since `pdf-parse` could rename/restructure `doc` on a version bump. For DOCX, prefer the far more reliable option: mammoth already maps Word's own "Heading 1..6" paragraph styles to `<h1>-<h6>` in its HTML output — extract those instead of reaching into any internals.
