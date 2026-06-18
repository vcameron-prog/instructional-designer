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

export async function buildXlsx(
  html: string,
  docTitle: string = "Accessible Spreadsheet",
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

    for (const tr of tableRows) {
      const cells = getDirectCells(tr);
      const isHeaderRow = cells.length > 0 && cells[0].tagName?.toLowerCase() === "th";

      const rowValues: string[] = cells.map((cell) => cellText(cell));
      const row = sheet.addRow(rowValues);

      if (isHeaderRow) {
        row.eachCell((cell) => {
          cell.font = { bold: true };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFE8E8E8" },
          };
        });
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
