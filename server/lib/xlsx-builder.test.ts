import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildXlsx } from "./xlsx-builder.js";

async function loadWorksheet(html: string, sheetIndex = 0): Promise<ExcelJS.Worksheet> {
  const buffer = await buildXlsx(html);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets[sheetIndex];
}

function mergeStrings(ws: ExcelJS.Worksheet): string[] {
  return (ws.model as any).merges ?? [];
}

describe("buildXlsx – colspan merging", () => {
  it("creates a merge range for a th with colspan=3", async () => {
    const html = `
      <table>
        <thead>
          <tr><th colspan="3">Full Name</th></tr>
        </thead>
        <tbody>
          <tr><td>First</td><td>Middle</td><td>Last</td></tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);
    const merges = mergeStrings(ws);

    expect(merges).toContain("A1:C1");
  });

  it("places the cell value at the master (top-left) position", async () => {
    const html = `
      <table>
        <thead>
          <tr><th colspan="2">Score</th></tr>
        </thead>
        <tbody>
          <tr><td>Alice</td><td>95</td></tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);

    expect(ws.getCell(1, 1).value).toBe("Score");
  });

  it("shifts subsequent columns past the spanned region", async () => {
    const html = `
      <table>
        <tbody>
          <tr>
            <td colspan="2">Merged</td>
            <td>Third</td>
          </tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);

    expect(ws.getCell(1, 1).value).toBe("Merged");
    expect(ws.getCell(1, 3).value).toBe("Third");
  });

  it("handles multiple colspan cells in the same row", async () => {
    const html = `
      <table>
        <tbody>
          <tr>
            <td colspan="2">Left</td>
            <td colspan="3">Right</td>
          </tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);
    const merges = mergeStrings(ws);

    expect(merges).toContain("A1:B1");
    expect(merges).toContain("C1:E1");
    expect(ws.getCell(1, 1).value).toBe("Left");
    expect(ws.getCell(1, 3).value).toBe("Right");
  });
});

describe("buildXlsx – rowspan merging", () => {
  it("creates a merge range for a td with rowspan=2", async () => {
    const html = `
      <table>
        <tbody>
          <tr><td rowspan="2">Category</td><td>Alpha</td></tr>
          <tr><td>Beta</td></tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);
    const merges = mergeStrings(ws);

    expect(merges).toContain("A1:A2");
  });

  it("places the rowspan master value at row 1 and leaves row 2 empty", async () => {
    const html = `
      <table>
        <tbody>
          <tr><td rowspan="2">Master</td><td>R1C2</td></tr>
          <tr><td>R2C2</td></tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);

    expect(ws.getCell(1, 1).value).toBe("Master");
    expect(ws.getCell(1, 2).value).toBe("R1C2");
    expect(ws.getCell(2, 2).value).toBe("R2C2");
  });

  it("pushes the column cursor past occupied cells in subsequent rows", async () => {
    const html = `
      <table>
        <tbody>
          <tr>
            <td rowspan="3">Span</td>
            <td>R1C2</td>
          </tr>
          <tr><td>R2C2</td></tr>
          <tr><td>R3C2</td></tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);

    expect(ws.getCell(1, 1).value).toBe("Span");
    expect(ws.getCell(1, 2).value).toBe("R1C2");
    expect(ws.getCell(2, 2).value).toBe("R2C2");
    expect(ws.getCell(3, 2).value).toBe("R3C2");
  });

  it("creates a rowspan merge spanning 3 rows", async () => {
    const html = `
      <table>
        <tbody>
          <tr><td rowspan="3">Three</td><td>A</td></tr>
          <tr><td>B</td></tr>
          <tr><td>C</td></tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);
    const merges = mergeStrings(ws);

    expect(merges).toContain("A1:A3");
  });
});

describe("buildXlsx – combined colspan + rowspan on the same cell", () => {
  it("merges a 2×2 block when a cell has both colspan=2 and rowspan=2", async () => {
    const html = `
      <table>
        <tbody>
          <tr>
            <td colspan="2" rowspan="2">Big</td>
            <td>R1C3</td>
          </tr>
          <tr>
            <td>R2C3</td>
          </tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);
    const merges = mergeStrings(ws);

    expect(merges).toContain("A1:B2");
  });

  it("places the value at the top-left master cell and leaves the rest empty", async () => {
    const html = `
      <table>
        <tbody>
          <tr>
            <td colspan="2" rowspan="2">Master</td>
            <td>C3</td>
          </tr>
          <tr>
            <td>D3</td>
          </tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);

    expect(ws.getCell(1, 1).value).toBe("Master");
    expect(ws.getCell(1, 3).value).toBe("C3");
    expect(ws.getCell(2, 3).value).toBe("D3");
  });

  it("correctly resolves column positions for cells after the 2×2 span", async () => {
    const html = `
      <table>
        <tbody>
          <tr>
            <td colspan="2" rowspan="2">Span</td>
            <td>After-R1</td>
          </tr>
          <tr>
            <td>After-R2</td>
          </tr>
          <tr>
            <td>Normal-A</td>
            <td>Normal-B</td>
            <td>Normal-C</td>
          </tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);

    expect(ws.getCell(1, 1).value).toBe("Span");
    expect(ws.getCell(1, 3).value).toBe("After-R1");
    expect(ws.getCell(2, 3).value).toBe("After-R2");
    expect(ws.getCell(3, 1).value).toBe("Normal-A");
    expect(ws.getCell(3, 2).value).toBe("Normal-B");
    expect(ws.getCell(3, 3).value).toBe("Normal-C");
  });

  it("handles a 3-column header with a rowspan=2 first cell followed by two colspan=1 cells", async () => {
    const html = `
      <table>
        <thead>
          <tr>
            <th rowspan="2">ID</th>
            <th colspan="2">Name</th>
          </tr>
          <tr>
            <th>First</th>
            <th>Last</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>1</td><td>Jane</td><td>Doe</td></tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);
    const merges = mergeStrings(ws);

    expect(merges).toContain("A1:A2");
    expect(merges).toContain("B1:C1");
    expect(ws.getCell(1, 1).value).toBe("ID");
    expect(ws.getCell(1, 2).value).toBe("Name");
    expect(ws.getCell(2, 2).value).toBe("First");
    expect(ws.getCell(2, 3).value).toBe("Last");
    expect(ws.getCell(3, 1).value).toBe("1");
  });
});

describe("buildXlsx – degenerate / edge-case input", () => {
  it("returns a usable workbook for an empty table (no rows)", async () => {
    const html = `<table></table>`;
    await expect(buildXlsx(html)).resolves.toBeInstanceOf(Buffer);
    const ws = await loadWorksheet(html);
    expect(ws).toBeDefined();
  });

  it("treats colspan=\"0\" as colspan=1 (no crash, no merge)", async () => {
    const html = `
      <table>
        <tbody>
          <tr><td colspan="0">Cell</td><td>Next</td></tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);
    const merges = mergeStrings(ws);

    expect(merges).toHaveLength(0);
    expect(ws.getCell(1, 1).value).toBe("Cell");
    expect(ws.getCell(1, 2).value).toBe("Next");
  });

  it("treats a non-numeric rowspan as rowspan=1 (no crash, no merge)", async () => {
    const html = `
      <table>
        <tbody>
          <tr><td rowspan="abc">Cell</td><td>Right</td></tr>
          <tr><td>Below-left</td><td>Below-right</td></tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);
    const merges = mergeStrings(ws);

    expect(merges).toHaveLength(0);
    expect(ws.getCell(1, 1).value).toBe("Cell");
    expect(ws.getCell(2, 1).value).toBe("Below-left");
  });

  it("clamps an unreasonably large colspan to the Excel column limit without throwing", async () => {
    const html = `
      <table>
        <tbody>
          <tr><td colspan="999999">Wide</td></tr>
        </tbody>
      </table>`;

    await expect(buildXlsx(html)).resolves.toBeInstanceOf(Buffer);
    const ws = await loadWorksheet(html);
    expect(ws.getCell(1, 1).value).toBe("Wide");
  });

  it("clamps an unreasonably large rowspan to the Excel row limit without throwing", async () => {
    const html = `
      <table>
        <tbody>
          <tr><td rowspan="9999999">Tall</td><td>R1C2</td></tr>
          <tr><td>R2C2</td></tr>
        </tbody>
      </table>`;

    await expect(buildXlsx(html)).resolves.toBeInstanceOf(Buffer);
    const ws = await loadWorksheet(html);
    expect(ws.getCell(1, 1).value).toBe("Tall");
    expect(ws.getCell(1, 2).value).toBe("R1C2");
  });
});

describe("buildXlsx – occupancy grid correctness", () => {
  it("does not overwrite a position already occupied by a rowspan from above", async () => {
    const html = `
      <table>
        <tbody>
          <tr>
            <td rowspan="2">Left</td>
            <td>Top-Right</td>
          </tr>
          <tr>
            <td>Bottom-Right</td>
          </tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);

    expect(ws.getCell(1, 1).value).toBe("Left");
    expect(ws.getCell(1, 2).value).toBe("Top-Right");
    expect(ws.getCell(2, 1).value).not.toBe("Bottom-Right");
    expect(ws.getCell(2, 2).value).toBe("Bottom-Right");
  });

  it("produces no merge entry for a plain 1×1 cell", async () => {
    const html = `
      <table>
        <tbody>
          <tr><td>Solo</td></tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);
    const merges = mergeStrings(ws);

    expect(merges).toHaveLength(0);
    expect(ws.getCell(1, 1).value).toBe("Solo");
  });
});
