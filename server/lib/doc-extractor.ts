import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import type { PdfExtraction } from "./pdf-processor";

export async function extractDocContent(buffer: Buffer): Promise<PdfExtraction> {
  const WordExtractor = (await import("word-extractor")).default;
  const extractor = new WordExtractor();

  let tmpPath: string | null = null;
  try {
    tmpPath = join(tmpdir(), `doc-${randomUUID()}.doc`);
    writeFileSync(tmpPath, buffer);

    const extracted = await extractor.extract(tmpPath);
    const bodyText: string = extracted.getBody() ?? "";
    const footnotesText: string = extracted.getFootnotes() ?? "";
    const headersText: string = extracted.getHeaders() ?? "";

    const allText = [bodyText, headersText, footnotesText]
      .filter((t) => t.trim().length > 0)
      .join("\n\n");

    const paragraphs = bodyText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const estimatedPages = Math.max(1, Math.ceil(paragraphs.length / 30));

    return {
      text: allText.trim(),
      pageCount: estimatedPages,
      metadata: {},
      images: [],
      tables: [],
    };
  } finally {
    if (tmpPath) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
