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

  parser.destroy();

  return {
    text: fullText.trim(),
    pageCount,
    metadata,
    images: [],
    tables,
  };
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
