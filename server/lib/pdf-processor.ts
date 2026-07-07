import { PDFParse } from "pdf-parse";

export interface ExtractedImage {
  pageNumber: number;
  name: string;
  width: number;
  height: number;
  dataUrl: string;
}

export interface ExtractedTable {
  pageNumber: number;
  rows: string[][];
}

export interface PdfExtraction {
  text: string;
  pageCount: number;
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
  };
  images: ExtractedImage[];
  tables: ExtractedTable[];
  /** Non-fatal warnings about the source file that users should be aware of. */
  warnings?: string[];
  /**
   * Lines of text that are structurally known to be headings, based on real
   * document metadata rather than a text-shape guess. For PDFs this comes
   * from rendered font size relative to the document's body-text baseline;
   * for DOCX this comes from Word's own paragraph heading styles (see
   * docx-extractor.ts). Best-effort: may be empty when the source format or
   * a given file doesn't expose this metadata.
   */
  headingLines?: string[];
}

export async function extractPdfContent(
  buffer: Buffer,
): Promise<PdfExtraction> {
  const parser = new PDFParse({ data: buffer, verbosity: 0 });

  const textResult = await parser.getText();
  const fullText = textResult?.text || "";
  const pageCount = textResult?.total || 1;

  const metadata: PdfExtraction["metadata"] = {};
  try {
    const info = await parser.getInfo();
    if (info) {
      metadata.title = (info as any).Title || (info as any).title || undefined;
      metadata.author =
        (info as any).Author || (info as any).author || undefined;
      metadata.subject =
        (info as any).Subject || (info as any).subject || undefined;
      metadata.creator =
        (info as any).Creator || (info as any).creator || undefined;
    }
  } catch {
    // metadata not available
  }

  const MAX_PAGES_TO_PROCESS = 200;
  const effectivePageCount = Math.min(pageCount, MAX_PAGES_TO_PROCESS);
  if (pageCount > MAX_PAGES_TO_PROCESS) {
    console.warn(`[pdf-processor] Document has ${pageCount} pages; processing capped at ${MAX_PAGES_TO_PROCESS} to limit resource usage.`);
  }

  const tables: ExtractedTable[] = [];
  for (let i = 1; i <= effectivePageCount; i++) {
    try {
      const pageTables = await (parser as any).getPageTables(i);
      if (pageTables && Array.isArray(pageTables)) {
        for (const table of pageTables) {
          if (table && table.rows && table.rows.length > 0) {
            tables.push({
              pageNumber: i,
              rows: table.rows.map((row: any[]) =>
                row.map((cell: any) => String(cell ?? "")),
              ),
            });
          }
        }
      }
    } catch {
      // tables not available on this page
    }
  }

  const headingLines = await extractHeadingLinesFromFontMetadata(
    parser,
    effectivePageCount,
  );

  parser.destroy();

  return {
    text: fullText.trim(),
    pageCount,
    metadata,
    images: [],
    tables,
    headingLines,
  };
}

/**
 * Best-effort extraction of "real" headings from a PDF's rendered font
 * metadata, rather than guessing from text shape alone.
 *
 * pdf-parse's public API (getText/getInfo/getTable) does not expose
 * per-line font size, so this reaches into the underlying pdf.js document
 * (`parser.doc`, populated once `getText()`/`getInfo()` has run) to read
 * each text item's rendered `height`, which is a reliable proxy for font
 * size. Lines whose height is meaningfully larger than the document's most
 * common ("body text") line height are treated as true headings.
 *
 * This depends on pdf-parse's internal structure rather than a documented
 * public contract, so every step is wrapped defensively: if the internals
 * are unavailable or throw for any reason, this returns an empty array and
 * callers fall back to the existing text-shape heuristic exactly as before.
 */
async function extractHeadingLinesFromFontMetadata(
  parser: PDFParse,
  effectivePageCount: number,
): Promise<string[]> {
  try {
    const doc = (parser as any).doc;
    if (!doc || typeof doc.getPage !== "function") return [];

    type LineInfo = { text: string; height: number };
    const allLines: LineInfo[] = [];

    for (let pageNum = 1; pageNum <= effectivePageCount; pageNum++) {
      try {
        const page = await doc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const items: any[] = textContent?.items || [];

        let currentLine: { parts: string[]; maxHeight: number } | null = null;
        let lastY: number | undefined;
        const LINE_Y_THRESHOLD = 3;

        const flushLine = () => {
          if (currentLine && currentLine.parts.length > 0) {
            const text = currentLine.parts.join("").trim();
            if (text) allLines.push({ text, height: currentLine.maxHeight });
          }
          currentLine = null;
        };

        for (const item of items) {
          if (typeof item?.str !== "string") continue;
          const y = item.transform?.[5];
          const height = typeof item.height === "number" && item.height > 0
            ? item.height
            : 0;

          if (
            lastY !== undefined &&
            typeof y === "number" &&
            Math.abs(lastY - y) > LINE_Y_THRESHOLD
          ) {
            flushLine();
          }
          if (!currentLine) currentLine = { parts: [], maxHeight: 0 };
          currentLine.parts.push(item.str);
          currentLine.maxHeight = Math.max(currentLine.maxHeight, height);
          if (typeof y === "number") lastY = y;
          if (item.hasEOL) flushLine();
        }
        flushLine();
      } catch {
        // Skip pages that fail to yield text content; heading detection is
        // best-effort and should never block extraction.
      }
    }

    if (allLines.length < 5) return [];

    const heightBuckets = new Map<number, number>();
    for (const line of allLines) {
      const rounded = Math.round(line.height);
      if (rounded <= 0) continue;
      heightBuckets.set(
        rounded,
        (heightBuckets.get(rounded) || 0) + line.text.length,
      );
    }
    if (heightBuckets.size === 0) return [];

    let bodyHeight = 0;
    let bodyWeight = -1;
    for (const [height, weight] of heightBuckets) {
      if (weight > bodyWeight) {
        bodyWeight = weight;
        bodyHeight = height;
      }
    }
    if (bodyHeight <= 0) return [];

    const HEADING_HEIGHT_RATIO = 1.15;
    const MAX_HEADING_WORDS = 15;
    const MAX_HEADING_LINES = 500;
    const headingLines: string[] = [];
    const seen = new Set<string>();
    for (const line of allLines) {
      if (line.height < bodyHeight * HEADING_HEIGHT_RATIO) continue;
      const trimmed = line.text.trim();
      if (trimmed.length < 2 || trimmed.length > 150) continue;
      const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
      if (wordCount > MAX_HEADING_WORDS) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      headingLines.push(trimmed);
      if (headingLines.length >= MAX_HEADING_LINES) break;
    }
    return headingLines;
  } catch {
    return [];
  }
}

export function needsOcr(text: string, pageCount: number): boolean {
  const trimmed = text.replace(/\s+/g, " ").trim();
  const charsPerPage = pageCount > 0 ? trimmed.length / pageCount : 0;
  return charsPerPage < 50;
}

export function findScannedPages(images: ExtractedImage[]): Set<number> {
  const pages = new Set<number>();
  const LARGE_IMAGE_THRESHOLD = 500 * 500;
  for (const img of images) {
    if (img.width * img.height >= LARGE_IMAGE_THRESHOLD) {
      pages.add(img.pageNumber);
    }
  }
  return pages;
}
