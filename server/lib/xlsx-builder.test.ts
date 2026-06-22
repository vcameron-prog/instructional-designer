import { describe, it, expect, vi, afterEach } from "vitest";
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

describe("buildXlsx – colspan clamping to true table width", () => {
  it("clamps a colspan wider than the data columns so no phantom columns appear", async () => {
    const html = `
      <table>
        <thead>
          <tr><th colspan="10">Wide Header</th></tr>
        </thead>
        <tbody>
          <tr><td>A</td><td>B</td><td>C</td></tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);
    const merges = mergeStrings(ws);

    // The merge must be clamped to the 3 actual data columns, not 10
    expect(merges).toContain("A1:C1");
    expect(merges).not.toContain("A1:J1");

    // Data row should still be in columns 1–3 with no phantom gap
    expect(ws.getCell(2, 1).value).toBe("A");
    expect(ws.getCell(2, 2).value).toBe("B");
    expect(ws.getCell(2, 3).value).toBe("C");
    expect(ws.getCell(2, 4).value).toBeNull();
  });

  it("does not clamp a colspan that exactly matches the data column count", async () => {
    const html = `
      <table>
        <thead>
          <tr><th colspan="3">Exact Header</th></tr>
        </thead>
        <tbody>
          <tr><td>X</td><td>Y</td><td>Z</td></tr>
        </tbody>
      </table>`;

    const ws = await loadWorksheet(html);
    const merges = mergeStrings(ws);

    expect(merges).toContain("A1:C1");
    expect(ws.getCell(1, 1).value).toBe("Exact Header");
  });
});


// ---------------------------------------------------------------------------
// Pre-merge style capture helper
// ---------------------------------------------------------------------------
// We spy on Worksheet.prototype.mergeCells so we can read slave-cell styles
// at the exact moment the builder calls mergeCells(), before ExcelJS can
// propagate any styles internally during the merge operation.
// ---------------------------------------------------------------------------
type CellSnapshot = { bold: boolean | undefined; argb: string | undefined };

function snapCell(ws: ExcelJS.Worksheet, row: number, col: number): CellSnapshot {
  const c = ws.getCell(row, col);
  return {
    bold: (c.font as ExcelJS.Font | undefined)?.bold,
    argb: (c.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb,
  };
}

// ---------------------------------------------------------------------------
// Worksheet prototype reference
// ExcelJS does not expose Worksheet as a named export, so we obtain the
// prototype from a live instance – all worksheets share it.
// ---------------------------------------------------------------------------
function getWsProto(): Record<string, unknown> {
  return Object.getPrototypeOf(
    new ExcelJS.Workbook().addWorksheet("_probe"),
  ) as Record<string, unknown>;
}

function makeMergeSpy(snapshots: Map<string, CellSnapshot>) {
  const wsProto = getWsProto();
  const origFn = wsProto.mergeCells as (...args: unknown[]) => void;
  vi.spyOn(wsProto, "mergeCells").mockImplementation(
    function (this: ExcelJS.Worksheet, ...args: unknown[]) {
      // builder always calls mergeCells(startRow, startCol, endRow, endCol)
      const [sr, sc, er, ec] = args as [number, number, number, number];
      for (let r = sr; r <= er; r++) {
        for (let c = sc; c <= ec; c++) {
          if (r !== sr || c !== sc) {
            snapshots.set(`${r},${c}`, snapCell(this, r, c));
          }
        }
      }
      origFn.apply(this, args);
    },
  );
}

describe("buildXlsx – header cell styling (pre-merge verification)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies bold font and grey fill to all slave cells of a th colspan=3 before mergeCells() fires", async () => {
    const snapshots = new Map<string, CellSnapshot>();
    makeMergeSpy(snapshots);

    const html = `
      <table>
        <thead>
          <tr><th colspan="3">Full Name</th></tr>
        </thead>
        <tbody>
          <tr><td>First</td><td>Middle</td><td>Last</td></tr>
        </tbody>
      </table>`;

    await buildXlsx(html);

    // mergeCells must have been intercepted
    expect(snapshots.size).toBeGreaterThan(0);

    // We also verify the master cell (A1) is styled — read it from the live
    // workbook that buildXlsx wrote, then re-load to confirm post-build state.
    // The spy captures slave cells; load the buffer to verify the master too.
    const wsCheck = await loadWorksheet(html);
    const master = wsCheck.getCell(1, 1);
    expect(master.font?.bold).toBe(true);
    expect((master.fill as ExcelJS.FillPattern)?.fgColor?.argb).toBe("FFE8E8E8");

    // Slave cells B1 (1,2) and C1 (1,3) must be bold + grey BEFORE the merge
    const b1 = snapshots.get("1,2");
    expect(b1?.bold).toBe(true);
    expect(b1?.argb).toBe("FFE8E8E8");

    const c1 = snapshots.get("1,3");
    expect(c1?.bold).toBe(true);
    expect(c1?.argb).toBe("FFE8E8E8");
  });

  it("does NOT apply header styling to slave cells of a td colspan before mergeCells() fires", async () => {
    const snapshots = new Map<string, CellSnapshot>();
    makeMergeSpy(snapshots);

    const html = `
      <table>
        <tbody>
          <tr><td colspan="3">Data</td></tr>
        </tbody>
      </table>`;

    await buildXlsx(html);

    // Slave cells B1 and C1 must NOT have the grey fill
    const b1 = snapshots.get("1,2");
    expect(b1?.bold).toBeFalsy();
    expect(b1?.argb).not.toBe("FFE8E8E8");

    const c1 = snapshots.get("1,3");
    expect(c1?.bold).toBeFalsy();
    expect(c1?.argb).not.toBe("FFE8E8E8");
  });

  it("applies bold + grey to all slave cells in a th colspan=2 rowspan=2 before mergeCells() fires", async () => {
    const snapshots = new Map<string, CellSnapshot>();
    makeMergeSpy(snapshots);

    const html = `
      <table>
        <thead>
          <tr><th colspan="2" rowspan="2">Corner</th><th>Col3</th></tr>
          <tr><th>Col3-Row2</th></tr>
        </thead>
      </table>`;

    await buildXlsx(html);

    // All three slave cells of the 2×2 merged th (B1, A2, B2) must be styled
    for (const key of ["1,2", "2,1", "2,2"]) {
      const snap = snapshots.get(key);
      expect(snap?.bold, `cell ${key} should be bold before merge`).toBe(true);
      expect(snap?.argb, `cell ${key} should have grey fill before merge`).toBe("FFE8E8E8");
    }
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
