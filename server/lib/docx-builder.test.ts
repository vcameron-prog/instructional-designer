import { describe, it, expect } from "vitest";
import { buildDocx } from "./docx-builder";
import { buildHeadingRenumberedNoteHtml } from "./accessibility-engine";
import mammoth from "mammoth";

// ---------------------------------------------------------------------------
// Integration tests: renumbering notice survives DOCX artifact generation
//
// These tests call the real buildDocx() (no mocking) and inspect the binary
// DOCX output via mammoth.  They prove that the renumbering notice HTML is not
// silently dropped or stripped when the DOCX builder serialises the document.
// ---------------------------------------------------------------------------

const BASE_METADATA = {
  title: "Test Document",
  filename: "test.pdf",
  lang: "en",
  author: "Accessibility Converter",
};

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function makeHtmlWithNotice(noticeHtml: string): string {
  return `<html lang="en"><head><title>Lecture</title></head><body>
${noticeHtml}
<h1>Main Section</h1>
<p>Body content here.</p>
</body></html>`;
}

describe("buildDocx — renumbering notice survives DOCX artifact", () => {
  it("includes the renumbering notice text in the generated DOCX when topmost heading was H2", async () => {
    const noticeHtml = buildHeadingRenumberedNoteHtml(2);
    const html = makeHtmlWithNotice(noticeHtml);

    const buffer = await buildDocx(html, BASE_METADATA);
    const text = await extractDocxText(buffer);

    expect(text).toContain("Heading levels in this document were automatically renumbered");
    expect(text).toContain("H2 instead of H1");
    expect(text).toContain("shifted by 1 level");
  });

  it("includes the renumbering notice text in the generated DOCX when topmost heading was H3", async () => {
    const noticeHtml = buildHeadingRenumberedNoteHtml(3);
    const html = makeHtmlWithNotice(noticeHtml);

    const buffer = await buildDocx(html, BASE_METADATA);
    const text = await extractDocxText(buffer);

    expect(text).toContain("Heading levels in this document were automatically renumbered");
    expect(text).toContain("H3 instead of H1");
    expect(text).toContain("shifted by 2 levels");
  });

  it("produces a valid DOCX buffer with content even without a renumbering notice", async () => {
    const html = `<html lang="en"><head><title>No Notice</title></head><body>
<h1>Normal Document</h1>
<p>No renumbering was necessary.</p>
</body></html>`;

    const buffer = await buildDocx(html, BASE_METADATA);
    const text = await extractDocxText(buffer);

    expect(text).toContain("Normal Document");
    expect(text).toContain("No renumbering was necessary");
    expect(text).not.toContain("automatically renumbered");
  });
});
