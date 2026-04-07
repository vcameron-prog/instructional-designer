import pdf from "pdf-parse";

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

export async function extractPdfContent(buffer: Buffer): Promise<PdfExtraction> {
  const data = await pdf(buffer);

  const metadata: PdfExtraction["metadata"] = {};
  if (data.info) {
    metadata.title = data.info.Title || undefined;
    metadata.author = data.info.Author || undefined;
    metadata.subject = data.info.Subject || undefined;
    metadata.creator = data.info.Creator || undefined;
  }

  return {
    text: data.text || "",
    pageCount: data.numpages || 1,
    metadata,
    images: [],
    tables: [],
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
