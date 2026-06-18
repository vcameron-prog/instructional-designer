import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import JSZip from "jszip";
import { extractOdfContent } from "./odf-extractor.js";

const fixturesDir = join(import.meta.dirname, "fixtures");

async function makeOdtBuffer(paragraphs: string[], tables?: { rows: string[][] }[]): Promise<Buffer> {
  const tableXml = (tables ?? []).map(({ rows }) => {
    const rowsXml = rows.map((cells) => {
      const cellsXml = cells.map((text) =>
        `<table:table-cell><text:p>${text}</text:p></table:table-cell>`
      ).join("");
      return `<table:table-row>${cellsXml}</table:table-row>`;
    }).join("");
    return `<table:table>${rowsXml}</table:table>`;
  }).join("");

  const parXml = paragraphs.map((p) => `<text:p>${p}</text:p>`).join("");

  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">
  <office:body><office:text>
    ${parXml}
    ${tableXml}
  </office:text></office:body>
</office:document-content>`;

  const zip = new JSZip();
  zip.file("content.xml", contentXml);
  const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
  return Buffer.from(arrayBuffer);
}

async function makeOdsBuffer(sheets: { name: string; rows: string[][] }[]): Promise<Buffer> {
  const sheetsXml = sheets.map(({ name, rows }) => {
    const rowsXml = rows.map((cells) => {
      const cellsXml = cells.map((text) =>
        `<table:table-cell><text:p>${text}</text:p></table:table-cell>`
      ).join("");
      return `<table:table-row>${cellsXml}</table:table-row>`;
    }).join("");
    return `<table:table table:name="${name}">${rowsXml}</table:table>`;
  }).join("");

  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">
  <office:body><office:spreadsheet>
    ${sheetsXml}
  </office:spreadsheet></office:body>
</office:document-content>`;

  const zip = new JSZip();
  zip.file("content.xml", contentXml);
  const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
  return Buffer.from(arrayBuffer);
}

async function makeOdpBuffer(slides: { paragraphs: string[] }[]): Promise<Buffer> {
  const NS_DRAW = "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0";

  const slidesXml = slides.map(({ paragraphs }) => {
    const textXml = paragraphs.map((p) => `<text:p>${p}</text:p>`).join("");
    return `<draw:page xmlns:draw="${NS_DRAW}">${textXml}</draw:page>`;
  }).join("");

  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0">
  <office:body><office:presentation>
    ${slidesXml}
  </office:presentation></office:body>
</office:document-content>`;

  const zip = new JSZip();
  zip.file("content.xml", contentXml);
  const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
  return Buffer.from(arrayBuffer);
}

describe("extractOdfContent — ODT", () => {
  it("extracts paragraph text from an ODT buffer", async () => {
    const buffer = await makeOdtBuffer([
      "Introduction to Accessibility",
      "This course covers WCAG 2.1 guidelines.",
    ]);
    const result = await extractOdfContent(buffer, "odt");

    expect(result.text).toContain("Introduction to Accessibility");
    expect(result.text).toContain("WCAG 2.1");
  });

  it("returns a non-empty tables array when the ODT contains a table", async () => {
    const buffer = await makeOdtBuffer(
      ["Some intro text"],
      [{ rows: [["Header A", "Header B"], ["Cell 1", "Cell 2"]] }],
    );
    const result = await extractOdfContent(buffer, "odt");

    expect(result.tables.length).toBeGreaterThanOrEqual(1);
    const flatCells = result.tables[0].rows.flat();
    expect(flatCells).toContain("Header A");
    expect(flatCells).toContain("Cell 2");
  });

  it("returns at least 1 page", async () => {
    const buffer = await makeOdtBuffer(["Hello"]);
    const result = await extractOdfContent(buffer, "odt");

    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });

  it("returns the correct PdfExtraction shape", async () => {
    const buffer = await makeOdtBuffer(["Test paragraph"]);
    const result = await extractOdfContent(buffer, "odt");

    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(result).toHaveProperty("images");
    expect(result).toHaveProperty("tables");
    expect(Array.isArray(result.images)).toBe(true);
    expect(Array.isArray(result.tables)).toBe(true);
    expect(result.images).toEqual([]);
  });

  it("reads title and author from meta.xml when present", async () => {
    const metaXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0">
  <office:meta>
    <dc:title>Sample ODT Title</dc:title>
    <dc:creator>Prof. Smith</dc:creator>
  </office:meta>
</office:document-meta>`;

    const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">
  <office:body><office:text><text:p>Body text</text:p></office:text></office:body>
</office:document-content>`;

    const zip = new JSZip();
    zip.file("content.xml", contentXml);
    zip.file("meta.xml", metaXml);
    const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
    const buffer = Buffer.from(arrayBuffer);

    const result = await extractOdfContent(buffer, "odt");

    expect(result.metadata.title).toBe("Sample ODT Title");
    expect(result.metadata.author).toBe("Prof. Smith");
  });

  it("throws when content.xml is missing from the archive", async () => {
    const zip = new JSZip();
    zip.file("other.xml", "<root/>");
    const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
    const buffer = Buffer.from(arrayBuffer);

    await expect(extractOdfContent(buffer, "odt")).rejects.toThrow();
  });
});

describe("extractOdfContent — ODS", () => {
  it("extracts sheet data into tables", async () => {
    const buffer = await makeOdsBuffer([
      {
        name: "Grades",
        rows: [
          ["Student", "Score"],
          ["Alice", "95"],
          ["Bob", "82"],
        ],
      },
    ]);
    const result = await extractOdfContent(buffer, "ods");

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].rows.flat()).toContain("Alice");
    expect(result.tables[0].rows.flat()).toContain("95");
  });

  it("includes sheet content in text output", async () => {
    const buffer = await makeOdsBuffer([
      { name: "Sheet1", rows: [["Name", "Value"], ["Test", "123"]] },
    ]);
    const result = await extractOdfContent(buffer, "ods");

    expect(result.text).toContain("Test");
  });

  it("handles multiple sheets", async () => {
    const buffer = await makeOdsBuffer([
      { name: "Sheet1", rows: [["A", "B"]] },
      { name: "Sheet2", rows: [["C", "D"]] },
    ]);
    const result = await extractOdfContent(buffer, "ods");

    expect(result.tables).toHaveLength(2);
  });

  it("returns the correct PdfExtraction shape", async () => {
    const buffer = await makeOdsBuffer([
      { name: "Data", rows: [["Col1", "Col2"], ["Val1", "Val2"]] },
    ]);
    const result = await extractOdfContent(buffer, "ods");

    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(result).toHaveProperty("images");
    expect(result).toHaveProperty("tables");
    expect(result.images).toEqual([]);
  });
});

describe("extractOdfContent — ODP", () => {
  it("extracts text from presentation slides", async () => {
    const buffer = await makeOdpBuffer([
      { paragraphs: ["Slide 1 Title", "First bullet point"] },
      { paragraphs: ["Slide 2 Title", "Second bullet point"] },
    ]);
    const result = await extractOdfContent(buffer, "odp");

    expect(result.text).toContain("Slide 1 Title");
    expect(result.text).toContain("Slide 2 Title");
  });

  it("returns at least 1 page", async () => {
    const buffer = await makeOdpBuffer([{ paragraphs: ["Hello"] }]);
    const result = await extractOdfContent(buffer, "odp");

    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });

  it("returns the correct PdfExtraction shape", async () => {
    const buffer = await makeOdpBuffer([{ paragraphs: ["Test slide"] }]);
    const result = await extractOdfContent(buffer, "odp");

    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(result).toHaveProperty("images");
    expect(result).toHaveProperty("tables");
    expect(result.images).toEqual([]);
  });
});

describe("extractOdfContent — fixture files", () => {
  it("extracts non-empty text from the sample.odt fixture", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.odt"));
    const result = await extractOdfContent(buffer, "odt");

    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("includes known body text from sample.odt", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.odt"));
    const result = await extractOdfContent(buffer, "odt");

    expect(result.text).toContain("Course Introduction");
    expect(result.text).toContain("accessible learning module");
  });

  it("extracts the embedded table from sample.odt", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.odt"));
    const result = await extractOdfContent(buffer, "odt");

    expect(result.tables.length).toBeGreaterThanOrEqual(1);
    const cells = result.tables[0].rows.flat();
    expect(cells).toContain("Assignment");
    expect(cells).toContain("Points");
  });

  it("reads title and author from sample.odt meta.xml", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.odt"));
    const result = await extractOdfContent(buffer, "odt");

    expect(result.metadata.title).toBe("Sample ODT Document");
    expect(result.metadata.author).toBe("Test Author");
  });

  it("extracts table data from the sample.ods fixture", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.ods"));
    const result = await extractOdfContent(buffer, "ods");

    expect(result.tables.length).toBeGreaterThanOrEqual(1);
    const cells = result.tables[0].rows.flat();
    expect(cells).toContain("Student");
    expect(cells).toContain("Alice");
    expect(cells).toContain("95");
  });

  it("includes sheet content in text output from sample.ods", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.ods"));
    const result = await extractOdfContent(buffer, "ods");

    expect(result.text).toContain("Alice");
  });

  it("extracts slide text from the sample.odp fixture", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.odp"));
    const result = await extractOdfContent(buffer, "odp");

    expect(result.text).toContain("Introduction Slide");
    expect(result.text).toContain("Key Concepts");
  });

  it("returns valid PdfExtraction shape for all three ODF formats", async () => {
    const cases: [string, "odt" | "ods" | "odp"][] = [
      ["sample.odt", "odt"],
      ["sample.ods", "ods"],
      ["sample.odp", "odp"],
    ];
    for (const [name, format] of cases) {
      const buffer = readFileSync(join(fixturesDir, name));
      const result = await extractOdfContent(buffer, format);

      expect(result).toHaveProperty("text");
      expect(result.pageCount).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(result.tables)).toBe(true);
      expect(result.images).toEqual([]);
    }
  });
});
