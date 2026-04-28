import ExcelJS from "exceljs";
import type { PdfExtraction, ExtractedTable } from "./pdf-processor";

function cellToString(cell: ExcelJS.CellValue): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return cell;
  if (typeof cell === "number" || typeof cell === "boolean") return String(cell);
  if (cell instanceof Date) return cell.toISOString();
  const obj = cell as unknown as Record<string, unknown>;
  if ("richText" in obj && Array.isArray(obj.richText)) {
    return (obj.richText as Array<{ text?: string }>).map((r) => r.text ?? "").join("");
  }
  if ("text" in obj && typeof obj.text === "string") return obj.text;
  if ("result" in obj) return obj.result !== undefined ? String(obj.result) : "";
  return "";
}

export async function extractXlsxContent(buffer: Buffer): Promise<PdfExtraction> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const tables: ExtractedTable[] = [];
  const textParts: string[] = [];

  const sheetsToProcess = workbook.worksheets.slice(0, 1);

  for (const worksheet of sheetsToProcess) {
    const rows: string[][] = [];

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as ExcelJS.CellValue[];
      const cells = values.slice(1).map(cellToString);
      if (cells.some((c) => c.trim().length > 0)) {
        rows.push(cells);
      }
    });

    if (rows.length > 0) {
      tables.push({ pageNumber: 1, rows: rows.map((r) => r.map(String)) });

      const sheetText = rows.map((row) => row.join("\t")).join("\n");
      textParts.push(`Sheet: ${worksheet.name}\n${sheetText}`);
    }
  }

  const text = textParts.join("\n\n");
  const estimatedPages = Math.max(1, Math.ceil(textParts.length));

  return {
    text: text.trim(),
    pageCount: estimatedPages,
    metadata: {},
    images: [],
    tables,
  };
}
