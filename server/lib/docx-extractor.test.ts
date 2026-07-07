import { describe, it, expect } from "vitest";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";
import { extractDocxContent } from "./docx-extractor";

async function buildTestDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: "Module 2: Grading Policy",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph("This is a regular body paragraph of prose."),
          new Paragraph({
            text: "Late Work",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph("Another regular body paragraph of prose."),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

describe("extractDocxContent — heading metadata from Word paragraph styles", () => {
  it("returns headingLines populated from real Heading 1/2 styles, not body paragraphs", async () => {
    const buffer = await buildTestDocx();
    const result = await extractDocxContent(buffer);

    expect(result.headingLines).toContain("Module 2: Grading Policy");
    expect(result.headingLines).toContain("Late Work");
    expect(result.headingLines).not.toContain(
      "This is a regular body paragraph of prose.",
    );
  });
});
