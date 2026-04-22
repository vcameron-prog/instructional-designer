import { parse } from "node-html-parser";

/**
 * Converts a header row's cells from <td> to <th scope="col">.
 */
export function _convertRowToHeaderCells(row: string): string {
  return row.replace(/<td(\s[^>]*)?>[\s\S]*?<\/td>/gi, (cell: string) => {
    const inner = cell.replace(/^<td[^>]*>/i, "").replace(/<\/td>$/i, "");
    return `<th scope="col">${inner}</th>`;
  });
}

/**
 * Inserts a <caption> after the opening tag of every HTML table that is
 * missing one.  The caption text defaults to "Table summary" but can be
 * overridden via the optional captionTexts parameter (a single string or an
 * array of strings — one per uncaptioned table, in document order).
 *
 * Uses node-html-parser so that every table at every nesting level is visited
 * independently, avoiding the mis-matched range problem that a non-greedy
 * regex produces with nested tables.  insertAdjacentHTML is used for DOM
 * mutation to keep existing child node references stable.
 */
export function fixHtmlTableCaption(text: string, captionTexts: string | string[] = "Table summary"): string {
  const captions = Array.isArray(captionTexts) ? captionTexts : [captionTexts];
  const root = parse(text);
  const tables = root.querySelectorAll("table");

  let tableIndex = 0;
  for (const table of tables) {
    const hasCaption = table.children.some(
      (c) => c.tagName.toLowerCase() === "caption",
    );
    if (!hasCaption) {
      const safeCaption = (captions[tableIndex] || "Table summary").trim() || "Table summary";
      tableIndex++;
      table.insertAdjacentHTML("afterbegin", `<caption>${safeCaption}</caption>\n`);
    }
  }

  return root.toString();
}

/**
 * Wraps the first <tr> in a <thead> (converting its <td> cells to
 * <th scope="col">) for every HTML table that is missing a <thead>.
 * When the table already uses a <tbody>, the first row is extracted from
 * <tbody> and re-inserted as a direct <thead> child of <table> so the
 * resulting structure is valid HTML.
 *
 * Uses node-html-parser and processes tables from innermost to outermost so
 * that each table is treated as a self-contained unit regardless of nesting.
 */
export function fixHtmlTableThead(text: string): string {
  const root = parse(text);
  const tables = root.querySelectorAll("table");

  // Reverse so innermost tables are processed first; this ensures that when
  // we examine an outer table its inner tables are already complete and their
  // thead elements are visible to the direct-child check below.
  for (const table of [...tables].reverse()) {
    const hasThead = table.children.some(
      (c) => c.tagName.toLowerCase() === "thead",
    );
    if (hasThead) continue;

    const tbody = table.children.find(
      (c) => c.tagName.toLowerCase() === "tbody",
    );

    if (tbody) {
      const firstTr = tbody.children.find(
        (c) => c.tagName.toLowerCase() === "tr",
      );
      if (!firstTr) continue;

      const convertedRow = _convertRowToHeaderCells(firstTr.outerHTML);
      firstTr.remove();
      tbody.insertAdjacentHTML("beforebegin", `<thead>\n${convertedRow}\n</thead>\n`);
    } else {
      const firstTr = table.children.find(
        (c) => c.tagName.toLowerCase() === "tr",
      );
      if (!firstTr) continue;

      const convertedRow = _convertRowToHeaderCells(firstTr.outerHTML);
      const theadNode = parse(`<thead>\n${convertedRow}\n</thead>`).firstChild;
      if (theadNode) {
        firstTr.replaceWith(theadNode);
      }
    }
  }

  return root.toString();
}
