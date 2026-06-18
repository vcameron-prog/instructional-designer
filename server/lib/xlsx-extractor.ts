import ExcelJS from "exceljs";
import { inspectZip } from "./zip-guard";
import type { PdfExtraction, ExtractedTable } from "./pdf-processor";

const MAX_WORKSHEETS = 10;
const MAX_ROWS_PER_SHEET = 10000;
const MAX_COLS_PER_ROW = 500;
const MAX_TOTAL_CELLS = 200000;

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

export async function extractXlsxContent(
  buffer: Buffer,
  selectedSheet?: string | null,
): Promise<PdfExtraction> {
  inspectZip(buffer, "XLSX");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  if (workbook.worksheets.length > MAX_WORKSHEETS) {
    throw new Error(
      `Rejected XLSX: too many worksheets (${workbook.worksheets.length}; limit ${MAX_WORKSHEETS})`,
    );
  }

  let sheetsToProcess: ExcelJS.Worksheet[];

  if (selectedSheet && selectedSheet.trim().length > 0) {
    const trimmed = selectedSheet.trim();
    const asNumber = Number(trimmed);

    let found: ExcelJS.Worksheet | undefined;

    if (!isNaN(asNumber) && Number.isInteger(asNumber) && asNumber >= 1) {
      // 1-based index
      found = workbook.worksheets[asNumber - 1];
    }

    if (!found) {
      // Case-insensitive name match
      found = workbook.worksheets.find(
        (ws) => ws.name.toLowerCase() === trimmed.toLowerCase(),
      );
    }

    if (!found) {
      const names = workbook.worksheets.map((ws) => `"${ws.name}"`).join(", ");
      throw new Error(
        `Sheet "${trimmed}" not found. Available sheets: ${names}`,
      );
    }

    sheetsToProcess = [found];
  } else {
    sheetsToProcess = workbook.worksheets.slice(0, 1);
  }

  const tables: ExtractedTable[] = [];
  const textParts: string[] = [];

  let totalCells = 0;

  for (const worksheet of sheetsToProcess) {
    const rows: string[][] = [];
    let rowCount = 0;

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      if (rowCount >= MAX_ROWS_PER_SHEET) {
        throw new Error(
          `Rejected XLSX: worksheet "${worksheet.name}" exceeds ${MAX_ROWS_PER_SHEET} row limit`,
        );
      }

      const values = row.values as ExcelJS.CellValue[];
      const rawCells = values.slice(1);

      if (rawCells.length > MAX_COLS_PER_ROW) {
        throw new Error(
          `Rejected XLSX: worksheet "${worksheet.name}" row ${row.number} exceeds ${MAX_COLS_PER_ROW} column limit`,
        );
      }

      totalCells += rawCells.length;
      if (totalCells > MAX_TOTAL_CELLS) {
        throw new Error(
          `Rejected XLSX: workbook exceeds ${MAX_TOTAL_CELLS} total cell limit`,
        );
      }

      const cells = rawCells.map(cellToString);
      if (cells.some((c) => c.trim().length > 0)) {
        rows.push(cells);
      }

      rowCount++;
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
