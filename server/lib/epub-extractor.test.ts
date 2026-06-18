import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import JSZip from "jszip";
import { extractEpubContent } from "./epub-extractor.js";

const fixturesDir = join(import.meta.dirname, "fixtures");

interface ChapterDef {
  id: string;
  href: string;
  html: string;
}

async function makeEpubBuffer(options: {
  title?: string;
  author?: string;
  chapters: ChapterDef[];
}): Promise<Buffer> {
  const { title = "Test Book", author = "Test Author", chapters } = options;

  const zip = new JSZip();

  zip.file("mimetype", "application/epub+zip");

  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  const manifestItems = chapters
    .map(
      (ch) =>
        `<item id="${ch.id}" href="${ch.href}" media-type="application/xhtml+xml"/>`,
    )
    .join("\n    ");

  const spineItems = chapters
    .map((ch) => `<itemref idref="${ch.id}"/>`)
    .join("\n    ");

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`,
  );

  for (const ch of chapters) {
    zip.file(`OEBPS/${ch.href}`, ch.html);
  }

  const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
  return Buffer.from(arrayBuffer);
}

describe("extractEpubContent", () => {
  it("extracts text from a single-chapter EPUB", async () => {
    const buffer = await makeEpubBuffer({
      chapters: [
        {
          id: "ch1",
          href: "chapter1.xhtml",
          html: `<html><body><p>Introduction to accessibility in higher education.</p></body></html>`,
        },
      ],
    });
    const result = await extractEpubContent(buffer);

    expect(result.text).toContain("Introduction to accessibility");
  });

  it("extracts text across multiple chapters", async () => {
    const buffer = await makeEpubBuffer({
      chapters: [
        {
          id: "ch1",
          href: "ch1.xhtml",
          html: `<html><body><p>Chapter One content here.</p></body></html>`,
        },
        {
          id: "ch2",
          href: "ch2.xhtml",
          html: `<html><body><p>Chapter Two content here.</p></body></html>`,
        },
      ],
    });
    const result = await extractEpubContent(buffer);

    expect(result.text).toContain("Chapter One");
    expect(result.text).toContain("Chapter Two");
  });

  it("extracts the title and author from OPF metadata", async () => {
    const buffer = await makeEpubBuffer({
      title: "Learning Design",
      author: "Dr. Jane Doe",
      chapters: [
        {
          id: "ch1",
          href: "ch1.xhtml",
          html: `<html><body><p>Content</p></body></html>`,
        },
      ],
    });
    const result = await extractEpubContent(buffer);

    expect(result.metadata.title).toBe("Learning Design");
    expect(result.metadata.author).toBe("Dr. Jane Doe");
  });

  it("extracts tables from chapter HTML", async () => {
    const buffer = await makeEpubBuffer({
      chapters: [
        {
          id: "ch1",
          href: "ch1.xhtml",
          html: `<html><body>
            <p>Grading table</p>
            <table>
              <tr><th>Assignment</th><th>Points</th></tr>
              <tr><td>Essay</td><td>100</td></tr>
              <tr><td>Quiz</td><td>50</td></tr>
            </table>
          </body></html>`,
        },
      ],
    });
    const result = await extractEpubContent(buffer);

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].rows.flat()).toContain("Assignment");
    expect(result.tables[0].rows.flat()).toContain("Essay");
  });

  it("does not include table text in the body text (no double-counting)", async () => {
    const buffer = await makeEpubBuffer({
      chapters: [
        {
          id: "ch1",
          href: "ch1.xhtml",
          html: `<html><body>
            <table><tr><td>UNIQUE_TABLE_CELL_CONTENT</td></tr></table>
          </body></html>`,
        },
      ],
    });
    const result = await extractEpubContent(buffer);

    expect(result.text).not.toContain("UNIQUE_TABLE_CELL_CONTENT");
  });

  it("strips script and style from chapter text", async () => {
    const buffer = await makeEpubBuffer({
      chapters: [
        {
          id: "ch1",
          href: "ch1.xhtml",
          html: `<html><head>
            <style>body { font-size: 12px; }</style>
            <script>var x = 1;</script>
          </head><body><p>Readable text</p></body></html>`,
        },
      ],
    });
    const result = await extractEpubContent(buffer);

    expect(result.text).toContain("Readable text");
    expect(result.text).not.toContain("font-size");
    expect(result.text).not.toContain("var x");
  });

  it("returns pageCount equal to the number of chapters", async () => {
    const buffer = await makeEpubBuffer({
      chapters: [
        { id: "ch1", href: "ch1.xhtml", html: `<html><body><p>A</p></body></html>` },
        { id: "ch2", href: "ch2.xhtml", html: `<html><body><p>B</p></body></html>` },
        { id: "ch3", href: "ch3.xhtml", html: `<html><body><p>C</p></body></html>` },
      ],
    });
    const result = await extractEpubContent(buffer);

    expect(result.pageCount).toBe(3);
  });

  it("returns the correct PdfExtraction shape", async () => {
    const buffer = await makeEpubBuffer({
      chapters: [
        { id: "ch1", href: "ch1.xhtml", html: `<html><body><p>Test</p></body></html>` },
      ],
    });
    const result = await extractEpubContent(buffer);

    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(result).toHaveProperty("images");
    expect(result).toHaveProperty("tables");
    expect(Array.isArray(result.images)).toBe(true);
    expect(Array.isArray(result.tables)).toBe(true);
    expect(result.images).toEqual([]);
  });

  it("throws when META-INF/container.xml is missing", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file("OEBPS/content.opf", "<package/>");
    const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
    const buffer = Buffer.from(arrayBuffer);

    await expect(extractEpubContent(buffer)).rejects.toThrow(
      /META-INF\/container\.xml/,
    );
  });
});

describe("extractEpubContent — fixture file", () => {
  it("extracts non-empty text from the sample.epub fixture", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.epub"));
    const result = await extractEpubContent(buffer);

    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("includes known content from both chapters in sample.epub", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.epub"));
    const result = await extractEpubContent(buffer);

    expect(result.text).toContain("Universal Design for Learning");
    expect(result.text).toContain("Accessibility Standards");
  });

  it("extracts the table from chapter 1 of sample.epub", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.epub"));
    const result = await extractEpubContent(buffer);

    expect(result.tables.length).toBeGreaterThanOrEqual(1);
    const cells = result.tables[0].rows.flat();
    expect(cells).toContain("Principle");
    expect(cells).toContain("Representation");
  });

  it("extracts title and author metadata from sample.epub", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.epub"));
    const result = await extractEpubContent(buffer);

    expect(result.metadata.title).toBe("Accessible Learning Guide");
    expect(result.metadata.author).toBe("Dr. Jane Smith");
  });

  it("returns pageCount matching the number of chapters in sample.epub", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.epub"));
    const result = await extractEpubContent(buffer);

    expect(result.pageCount).toBe(2);
  });

  it("returns the correct PdfExtraction shape for sample.epub", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.epub"));
    const result = await extractEpubContent(buffer);

    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(result).toHaveProperty("images");
    expect(result).toHaveProperty("tables");
    expect(result.images).toEqual([]);
  });
});
