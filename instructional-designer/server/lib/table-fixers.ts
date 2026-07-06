import { parse } from "node-html-parser";

/**
 * Escapes HTML-special characters in plain text so the value can be safely
 * embedded as text content inside an HTML element without being interpreted
 * as markup.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
 * missing one. The caption text defaults to "Table summary" but can be
 * overridden via the optional captionTexts parameter (a single string or an
 * array of strings — one per uncaptioned table, in document order).
 *
 * Uses node-html-parser so that every table at every nesting level is visited
 * independently, avoiding the mismatched-range problem that a non-greedy
 * regex produces with nested tables. insertAdjacentHTML is used for DOM
 * mutation to keep existing child node references stable.
 */
export function fixHtmlTableCaption(
  text: string,
  captionTexts: string | string[] = "Table summary",
): { html: string; tablesFixed: number } {
  const captions = Array.isArray(captionTexts) ? captionTexts : [captionTexts];
  const root = parse(text);
  const tables = root.querySelectorAll("table");

  let tableIndex = 0;
  for (const table of tables) {
    const hasCaption = table.children.some(
      (c) => c.tagName.toLowerCase() === "caption",
    );
    if (!hasCaption) {
      const rawCaption = (captions[tableIndex] || "Table summary").trim() || "Table summary";
      tableIndex++;
      table.insertAdjacentHTML("afterbegin", `<caption>${escapeHtml(rawCaption)}</caption>\n`);
    }
  }

  return { html: root.toString(), tablesFixed: tableIndex };
}

/**
 * Replaces the text of a specific <caption>…</caption> element identified by
 * its 0-based index in document order. When captionIndex is omitted every
 * caption is updated (legacy behaviour). Tables without a caption are left
 * untouched.
 */
export function editHtmlTableCaption(text: string, newCaption: string, captionIndex?: number): string {
  const trimmed = newCaption.trim() || "Table summary";
  const safeCaption = escapeHtml(trimmed);
  if (captionIndex === undefined) {
    return text.replace(/<caption([^>]*)>([\s\S]*?)<\/caption>/gi, (_match, attrs) => {
      return `<caption${attrs}>${safeCaption}</caption>`;
    });
  }
  let count = 0;
  return text.replace(/<caption([^>]*)>([\s\S]*?)<\/caption>/gi, (match, attrs) => {
    if (count === captionIndex) {
      count++;
      return `<caption${attrs}>${safeCaption}</caption>`;
    }
    count++;
    return match;
  });
}

/**
 * Finds groups of tables that share the same caption text and appends a
 * positional suffix ("(1 of N)", "(2 of N)", …) to each duplicate so that
 * every caption becomes unique. Tables without captions and tables whose
 * captions are already unique are left untouched.
 */
export function fixDuplicateTableCaptions(html: string): string {
  const root = parse(html);
  const tables = root.querySelectorAll("table");

  const captionMap = new Map<string, Array<{ el: ReturnType<typeof root.querySelector>; originalText: string }>>();

  for (const table of tables) {
    const captionEl = table.querySelector("caption");
    if (!captionEl) continue;
    const originalText = captionEl.text.trim();
    if (!originalText) continue;
    const normalized = originalText.toLowerCase();
    const group = captionMap.get(normalized) ?? [];
    group.push({ el: captionEl, originalText });
    captionMap.set(normalized, group);
  }

  for (const group of captionMap.values()) {
    if (group.length <= 1) continue;
    const total = group.length;
    group.forEach(({ el, originalText }, idx) => {
      el!.set_content(`${escapeHtml(originalText)} (${idx + 1} of ${total})`);
    });
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
export function fixHtmlTableThead(text: string): { html: string; tablesFixed: number } {
  const root = parse(text);
  const tables = root.querySelectorAll("table");

  let tablesFixed = 0;

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
      tablesFixed++;
    } else {
      const firstTr = table.children.find(
        (c) => c.tagName.toLowerCase() === "tr",
      );
      if (!firstTr) continue;

      const convertedRow = _convertRowToHeaderCells(firstTr.outerHTML);
      const theadNode = parse(`<thead>\n${convertedRow}\n</thead>`).firstChild;
      if (theadNode) {
        firstTr.replaceWith(theadNode);
        tablesFixed++;
      }
    }
  }

  return { html: root.toString(), tablesFixed };
}
