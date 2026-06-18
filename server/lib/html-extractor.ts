import { parse } from "node-html-parser";
import type { PdfExtraction, ExtractedTable } from "./pdf-processor";

export async function extractHtmlContent(buffer: Buffer): Promise<PdfExtraction> {
  const html = buffer.toString("utf8");
  const root = parse(html);

  // Remove script and style elements
  root.querySelectorAll("script, style, noscript").forEach((el) => el.remove());

  // Extract tables before reducing to text
  const tables: ExtractedTable[] = [];
  const tableElements = root.querySelectorAll("table");
  tableElements.forEach((table) => {
    const rows: string[][] = [];
    table.querySelectorAll("tr").forEach((tr) => {
      const cells: string[] = [];
      tr.querySelectorAll("td, th").forEach((cell) => {
        cells.push((cell.textContent || "").trim());
      });
      if (cells.length > 0) {
        rows.push(cells);
      }
    });
    if (rows.length > 0) {
      tables.push({ pageNumber: 1, rows });
    }
    // Remove table from DOM so its text isn't double-counted
    table.replaceWith("");
  });

  // Extract readable text from body or whole document
  const bodyEl = root.querySelector("body") ?? root;
  const rawText = bodyEl.textContent ?? "";

  // Clean up whitespace
  const text = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const estimatedPages = Math.max(1, Math.ceil(lines.length / 40));

  // Attempt to extract title from <title> or first heading
  const titleEl = root.querySelector("title");
  const h1El = root.querySelector("h1");
  const title =
    titleEl?.textContent?.trim() || h1El?.textContent?.trim() || undefined;

  return {
    text,
    pageCount: estimatedPages,
    metadata: title ? { title } : {},
    images: [],
    tables,
  };
}
