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
 * overridden via the optional captionText parameter.
 * Correctly handles opening tags that carry attributes (e.g. <table class="x">).
 *
 * Note: the non-greedy regex matches from each <table> opening tag to the
 * nearest </table>.  For nested tables this means a single match spans from
 * the outer table's opening tag to the inner table's closing tag; that
 * partial block is processed as a unit.
 */
export function fixHtmlTableCaption(text: string, captionTexts: string | string[] = "Table summary"): string {
  const captions = Array.isArray(captionTexts) ? captionTexts : [captionTexts];
  let tableIndex = 0;
  return text.replace(/<table(?:\s[^>]*)?>[\s\S]*?<\/table>/gi, (tableBlock) => {
    if (/<caption[\s>]/i.test(tableBlock)) return tableBlock;
    const safeCaption = (captions[tableIndex] || "Table summary").trim() || "Table summary";
    tableIndex++;
    return tableBlock.replace(/(<table(?:\s[^>]*)?>)/i, `$1<caption>${safeCaption}</caption>\n`);
  });
}

/**
 * Wraps the first <tr> in a <thead> (converting its <td> cells to
 * <th scope="col">) for every HTML table that is missing a <thead>.
 * When the table already uses a <tbody>, the first row is extracted from
 * <tbody> and re-inserted as a direct <thead> child of <table> so the
 * resulting structure is valid HTML.
 */
export function fixHtmlTableThead(text: string): string {
  return text.replace(/<table(?:\s[^>]*)?>[\s\S]*?<\/table>/gi, (tableBlock) => {
    if (/<thead[\s>]/i.test(tableBlock)) return tableBlock;

    if (/<tbody[\s>]/i.test(tableBlock)) {
      let extractedRow: string | null = null;
      const withoutFirstRow = tableBlock.replace(
        /(<tbody(?:\s[^>]*)?>)([\s\S]*?)(<\/tbody>)/i,
        (_full: string, open: string, body: string, close: string) => {
          const cleaned = body.replace(/(<tr[\s>][\s\S]*?<\/tr>)/i, (row: string) => {
            if (extractedRow === null) {
              extractedRow = row;
              return "";
            }
            return row;
          });
          return open + cleaned + close;
        },
      );
      if (extractedRow === null) return tableBlock;
      const convertedRow = _convertRowToHeaderCells(extractedRow as string);
      return withoutFirstRow.replace(
        /(<table(?:\s[^>]*)?>)/i,
        `$1<thead>\n${convertedRow}\n</thead>\n`,
      );
    }

    return tableBlock.replace(/(<tr[\s>][\s\S]*?<\/tr>)/i, (firstRow) => {
      return `<thead>\n${_convertRowToHeaderCells(firstRow)}\n</thead>`;
    });
  });
}
