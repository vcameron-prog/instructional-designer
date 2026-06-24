import ExcelJS from "exceljs";
import { parse, HTMLElement, NodeType } from "node-html-parser";

function getDirectTableRows(table: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = [];
  const SECTION_TAGS = new Set(["thead", "tbody", "tfoot"]);
  for (const child of table.childNodes) {
    const el = child as HTMLElement;
    const tag = el.tagName?.toLowerCase();
    if (tag === "tr") {
      rows.push(el);
    } else if (SECTION_TAGS.has(tag)) {
      for (const sectionChild of el.childNodes) {
        const sEl = sectionChild as HTMLElement;
        if (sEl.tagName?.toLowerCase() === "tr") {
          rows.push(sEl);
        }
      }
    }
  }
  return rows;
}

function getDirectCells(tr: HTMLElement): HTMLElement[] {
  return tr.childNodes
    .map((c) => c as HTMLElement)
    .filter((c) => {
      const t = c.tagName?.toLowerCase();
      return t === "td" || t === "th";
    });
}

function cellText(cell: HTMLElement): string {
  return (cell.textContent || "").replace(/\s+/g, " ").trim();
}

function findAllTables(root: HTMLElement): HTMLElement[] {
  const tables: HTMLElement[] = [];
  const walk = (node: HTMLElement) => {
    if (node.nodeType !== NodeType.ELEMENT_NODE) return;
    if (node.tagName?.toLowerCase() === "table") {
      tables.push(node);
      return;
    }
    for (const child of node.childNodes) {
      walk(child as HTMLElement);
    }
  };
  walk(root);
  return tables;
}

function tableCaption(table: HTMLElement): string | null {
  for (const child of table.childNodes) {
    const el = child as HTMLElement;
    if (el.tagName?.toLowerCase() === "caption") {
      return (el.textContent || "").replace(/\s+/g, " ").trim() || null;
    }
  }
  return null;
}

const MAX_COLSPAN = 16_384; // Excel column limit
const MAX_ROWSPAN = 1_000;  // practical cap; no real table rowspan exceeds this

function getSpan(cell: HTMLElement, attr: string): number {
  const raw = cell.getAttribute(attr);
  if (!raw) return 1;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  const max = attr === "colspan" ? MAX_COLSPAN : MAX_ROWSPAN;
  return Math.min(n, max);
}

const HEADER_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE8E8E8" },
};

export async function buildXlsx(
  html: string,
  _docTitle: string = "Accessible Spreadsheet",
): Promise<Buffer> {
  const root = parse(html);
  const tables = findAllTables(root as unknown as HTMLElement);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Accessibility Converter";
  workbook.created = new Date();

  if (tables.length === 0) {
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["No tables found in accessible HTML"]);
  }

  tables.forEach((table, idx) => {
    const caption = tableCaption(table);
    const sheetName = caption
      ? caption.slice(0, 31).replace(/[*?:/\\[\]]/g, "_")
      : tables.length === 1
        ? "Sheet1"
        : `Sheet${idx + 1}`;

    const sheet = workbook.addWorksheet(sheetName);

    const tableRows = getDirectTableRows(table);
    if (tableRows.length === 0) return;

    // Pre-pass: determine the true column width of the table (i.e. the widest
    // row measured as the sum of colspans).  Rows with more than one cell are
    // the reliable signal; single-cell rows (full-width title/caption rows)
    // are used only when no multi-cell row exists.
    let maxCols = 0;
    let maxColsSingleCell = 0;
    for (const row of tableRows) {
      const cells = getDirectCells(row);
      const colSum = cells.reduce(
        (sum, cell) => sum + getSpan(cell, "colspan"),
        0,
      );
      if (cells.length > 1) {
        if (colSum > maxCols) maxCols = colSum;
      } else {
        if (colSum > maxColsSingleCell) maxColsSingleCell = colSum;
      }
    }
    if (maxCols === 0) maxCols = maxColsSingleCell;
    if (maxCols === 0) maxCols = MAX_COLSPAN; // empty or all-no-cell table

    // Track which (excelRow, excelCol) positions are already consumed by a
    // spanning cell from an earlier row or an earlier cell in the same row.
    // Keys are "row,col" strings (both 1-indexed).
    const occupied = new Set<string>();

    for (let rowIdx = 0; rowIdx < tableRows.length; rowIdx++) {
      const tr = tableRows[rowIdx];
      const cells = getDirectCells(tr);
      const excelRow = rowIdx + 1; // 1-indexed

      let colCursor = 1; // 1-indexed column position

      for (const cell of cells) {
        // Advance past any positions already consumed by earlier rowspans
        while (occupied.has(`${excelRow},${colCursor}`)) {
          colCursor++;
        }

        const colspan = getSpan(cell, "colspan");
        const rowspan = getSpan(cell, "rowspan");
        const isHeader = cell.tagName?.toLowerCase() === "th";

        // Write the cell value at the resolved position
        const xlCell = sheet.getCell(excelRow, colCursor);
        xlCell.value = cellText(cell);

        if (isHeader) {
          xlCell.font = { bold: true };
          xlCell.fill = HEADER_FILL;
        }

        // Clamp colspan so the merge never extends past the table's true width.
        // This prevents phantom empty columns when a header like
        // colspan="10" appears in a table that only has 3 data columns.
        // The Math.max(..., 1) guards against colCursor exceeding maxCols
        // (possible with heavy overlapping rowspans), ensuring the cursor
        // always advances by at least one position.
        const effectiveColspan = Math.max(
          1,
          Math.min(colspan, maxCols - colCursor + 1),
        );

        // Handle merging when the cell spans multiple columns and/or rows
        if (effectiveColspan > 1 || rowspan > 1) {
          const endRow = Math.min(excelRow + rowspan - 1, 1_048_576);
          const endCol = Math.min(colCursor + effectiveColspan - 1, maxCols);

          // Mark every position in the span (except the master) as occupied
          // and apply header styling to slave cells so the full merged range
          // appears bold + grey in Excel and LibreOffice.
          for (let r = excelRow; r <= endRow; r++) {
            for (let c = colCursor; c <= endCol; c++) {
              if (r !== excelRow || c !== colCursor) {
                occupied.add(`${r},${c}`);
                if (isHeader) {
                  const slaveCell = sheet.getCell(r, c);
                  slaveCell.font = { bold: true };
                  slaveCell.fill = HEADER_FILL;
                }
              }
            }
          }

          // ExcelJS merge: master cell keeps its value; slave cells become empty
          sheet.mergeCells(excelRow, colCursor, endRow, endCol);
        }

        colCursor += effectiveColspan;
      }
    }

    sheet.columns.forEach((col) => {
      let maxLen = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? "").length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 2, 60);
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
