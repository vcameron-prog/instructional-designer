/**
 * Converts GitHub-flavoured markdown pipe tables found in `text` into accessible
 * HTML <table> elements with a <caption> and <th scope="col"> headers.
 *
 * The caption is derived from the nearest preceding heading, or "Data table" as fallback.
 */
export function convertMarkdownTablesToHtml(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let i = 0;
  let insideCodeFence = false;

  while (i < lines.length) {
    const line = lines[i];

    // Track fenced code blocks so we never transform table-like text inside them
    if (/^```/.test(line.trim())) {
      insideCodeFence = !insideCodeFence;
      result.push(line);
      i++;
      continue;
    }

    if (insideCodeFence) {
      result.push(line);
      i++;
      continue;
    }

    // Detect a markdown table: a line where most |-separated tokens look like table cells
    // A separator line looks like |---|---| or | --- | --- |
    const isTableRow = (l: string) => /^\|.+\|$/.test(l.trim());
    const isSeparatorRow = (l: string) => /^\|[\s\-:|]+\|$/.test(l.trim().replace(/[^|:\-\s]/g, ""));

    if (isTableRow(line) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      // Find the caption from the most recent heading line in result[]
      let caption = "Data table";
      for (let r = result.length - 1; r >= 0; r--) {
        const headingMatch = result[r].match(/^#{1,6}\s+(.+)$/) ||
          result[r].match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
        if (headingMatch) {
          caption = headingMatch[1].replace(/[*_`]/g, "").trim();
          break;
        }
      }

      // Parse header row
      const headerCells = line.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());

      // Skip separator row
      i += 2;

      // Collect body rows
      const bodyRows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
        bodyRows.push(cells);
        i++;
      }

      // Build HTML table
      const thCells = headerCells.map(h => `<th scope="col">${h}</th>`).join("");
      const tbodyRows = bodyRows.map(row => {
        const tdCells = row.map(c => `<td>${c}</td>`).join("");
        return `<tr>${tdCells}</tr>`;
      }).join("\n      ");

      const htmlTable = `<table>
  <caption>${caption}</caption>
  <thead>
    <tr>${thCells}</tr>
  </thead>
  <tbody>
    ${tbodyRows}
  </tbody>
</table>`;

      result.push(htmlTable);
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join("\n");
}
