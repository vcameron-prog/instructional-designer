import { parse as csvParse } from "csv-parse/sync";
import type { PdfExtraction, ExtractedTable } from "./pdf-processor";

const MAX_ROWS = 50000;
const MAX_COLS = 500;

export async function extractCsvContent(buffer: Buffer): Promise<PdfExtraction> {
  let records: string[][];
  try {
    records = csvParse(buffer, {
      relax_quotes: true,
      skip_empty_lines: true,
      cast: false,
      to: MAX_ROWS,
    }) as string[][];
  } catch (err: any) {
    throw new Error(`Failed to parse CSV: ${err.message}`);
  }

  if (records.length === 0) {
    return {
      text: "",
      pageCount: 1,
      metadata: {},
      images: [],
      tables: [],
    };
  }

  // Enforce column limit
  records = records.map((row) =>
    row.slice(0, MAX_COLS).map((cell) => String(cell ?? "")),
  );

  // Build human-readable text: headers (first row) + data rows
  const headers = records[0];
  const dataRows = records.slice(1);

  const textLines: string[] = [];
  textLines.push("Columns: " + headers.join(", "));
  textLines.push(`(${dataRows.length} data row${dataRows.length !== 1 ? "s" : ""})`);
  textLines.push("");

  // Include a sample of rows in the text (up to 200) for the accessibility AI
  const sampleRows = dataRows.slice(0, 200);
  for (const row of sampleRows) {
    textLines.push(
      headers.map((h, i) => `${h}: ${row[i] ?? ""}`).join(" | "),
    );
  }

  if (dataRows.length > 200) {
    textLines.push(`... and ${dataRows.length - 200} more rows`);
  }

  const text = textLines.join("\n").trim();

  const table: ExtractedTable = {
    pageNumber: 1,
    rows: records,
  };

  return {
    text,
    pageCount: 1,
    metadata: {},
    images: [],
    tables: [table],
  };
}
