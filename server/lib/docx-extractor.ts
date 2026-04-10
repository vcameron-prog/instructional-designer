import mammoth from "mammoth";
import { parse } from "node-html-parser";
import type {
  PdfExtraction,
  ExtractedImage,
  ExtractedTable,
} from "./pdf-processor";

export async function extractDocxContent(
  buffer: Buffer,
): Promise<PdfExtraction> {
  const result = await mammoth.convertToHtml({ buffer });
  const htmlContent = result.value;

  const textResult = await mammoth.extractRawText({ buffer });
  const rawText = textResult.value || "";

  const root = parse(htmlContent);

  const images: ExtractedImage[] = [];
  const imgElements = root.querySelectorAll("img");
  imgElements.forEach((img, index) => {
    const src = img.getAttribute("src") || "";
    const alt = img.getAttribute("alt") || "";
    const dataMatch = src.match(
      /^data:image\/(png|jpeg|jpg|gif|bmp|webp);base64,(.+)$/i,
    );
    if (dataMatch) {
      images.push({
        pageNumber: 1,
        name: alt || `image_${index}`,
        width: 400,
        height: 300,
        dataUrl: src,
      });
    }
  });

  const tables: ExtractedTable[] = [];
  const tableElements = root.querySelectorAll("table");
  tableElements.forEach((table) => {
    const rows: string[][] = [];
    const trElements = table.querySelectorAll("tr");
    trElements.forEach((tr) => {
      const cells: string[] = [];
      const cellElements = tr.querySelectorAll("td, th");
      cellElements.forEach((cell) => {
        cells.push((cell.textContent || "").trim());
      });
      if (cells.length > 0) {
        rows.push(cells);
      }
    });
    if (rows.length > 0) {
      tables.push({ pageNumber: 1, rows });
    }
  });

  const metadata: PdfExtraction["metadata"] = {};

  const paragraphs = rawText.split(/\n/).filter((l) => l.trim().length > 0);
  const estimatedPages = Math.max(1, Math.ceil(paragraphs.length / 30));

  return {
    text: rawText.trim(),
    pageCount: estimatedPages,
    metadata,
    images,
    tables,
  };
}
