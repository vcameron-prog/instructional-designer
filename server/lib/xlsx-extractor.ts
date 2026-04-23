import * as XLSX from "xlsx";
import type { PdfExtraction, ExtractedTable } from "./pdf-processor";

export async function extractXlsxContent(buffer: Buffer): Promise<PdfExtraction> {
  const workbook = XLSX.read(buffer, { type: "buffer" });

  const tables: ExtractedTable[] = [];
  const textParts: string[] = [];

  const sheetsToProcess = workbook.SheetNames.slice(0, 1);

  for (const sheetName of sheetsToProcess) {
    const sheet = workbook.Sheets[sheetName];
    const rows: string[][] = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as string[][];

    const nonEmptyRows = rows.filter((row) =>
      row.some((cell) => String(cell).trim().length > 0)
    );

    if (nonEmptyRows.length > 0) {
      tables.push({ pageNumber: 1, rows: nonEmptyRows.map((r) => r.map(String)) });

      const sheetText = nonEmptyRows.map((row) => row.join("\t")).join("\n");
      textParts.push(`Sheet: ${sheetName}\n${sheetText}`);
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
