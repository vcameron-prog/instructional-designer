# Changes to Apply to the Other Replit

Below are all the code changes from recent sessions. The file paths shown are from THIS Replit — you'll need to map them to your other project's structure.

**Mapping:**
- `shared/schema.ts` → `lib/db/src/schema/conversions.ts`
- `server/lib/accessibility-engine.ts` → `artifacts/api-server/src/lib/accessibility-engine.ts`
- `server/lib/docx-builder.ts` → `artifacts/api-server/src/lib/docx-builder.ts`
- `server/lib/pdf-builder.ts` → `artifacts/api-server/src/lib/pdf-builder.ts` (NEW FILE)
- `server/routes.ts` → `artifacts/api-server/src/routes/conversions.ts`
- `client/src/pages/pdf-conversion.tsx` → `artifacts/pdf-accessibility/src/pages/ConversionDetail.tsx`

---

## 1. SCHEMA — Add `statusMessage` column

Add this line to your conversions table schema (before `errorMessage`):

```typescript
statusMessage: text("status_message"),
```

Then run:
```sql
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS status_message TEXT;
```

---

## 2. DEPENDENCIES — Install for PDF download

```bash
pnpm add puppeteer-core
# System dependency (Nix/Replit):
# Add chromium to system packages
```

---

## 3. NEW FILE: `pdf-builder.ts` (PDF download support)

Create this file at `artifacts/api-server/src/lib/pdf-builder.ts`:

```typescript
import puppeteer from "puppeteer-core";
import { execSync } from "child_process";

function findChromiumPath(): string {
  if (process.env.CHROMIUM_PATH) {
    return process.env.CHROMIUM_PATH;
  }
  try {
    return execSync("which chromium", { encoding: "utf-8" }).trim();
  } catch {
    throw new Error(
      "Chromium not found. Install chromium or set the CHROMIUM_PATH environment variable."
    );
  }
}

const CHROMIUM_PATH = findChromiumPath();

export async function buildPdf(
  html: string,
  metadata: { title: string; lang: string; author?: string }
): Promise<Buffer> {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--font-render-hinting=none",
      ],
    });

    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.isNavigationRequest() && req.url() === "about:blank") {
        req.continue();
        return;
      }
      const url = req.url();
      if (url.startsWith("data:")) {
        req.continue();
        return;
      }
      req.abort("blockedbyclient");
    });

    await page.setJavaScriptEnabled(false);

    const styledHtml = injectPrintStyles(html, metadata);
    await page.setContent(styledHtml, { waitUntil: "domcontentloaded", timeout: 30000 });

    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<span></span>`,
      footerTemplate: `
        <div style="width:100%;text-align:center;font-size:9px;color:#666;padding:0 40px;">
          <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>
      `,
      margin: { top: "0.75in", bottom: "0.75in", left: "0.75in", right: "0.75in" },
      tagged: true,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

function injectPrintStyles(
  html: string,
  metadata: { title: string; lang: string; author?: string }
): string {
  const printCss = `
    <style>
      @media print {
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #000; }
        h1, h2, h3, h4, h5, h6 { page-break-after: avoid; margin-top: 1em; }
        table { page-break-inside: avoid; border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #666; padding: 6px 8px; text-align: left; }
        th { background-color: #e8e8e8 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        img { max-width: 100%; height: auto; page-break-inside: avoid; }
        pre, code { font-family: 'Courier New', monospace; font-size: 0.9em; white-space: pre-wrap; }
        a { color: #000; text-decoration: underline; }
        ul, ol { page-break-inside: avoid; }
        p { orphans: 3; widows: 3; }
      }
      body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #222; max-width: 100%; margin: 0; padding: 0; }
      h1 { font-size: 1.8em; margin-bottom: 0.5em; }
      h2 { font-size: 1.4em; margin-bottom: 0.4em; }
      h3 { font-size: 1.2em; margin-bottom: 0.3em; }
      table { border-collapse: collapse; width: 100%; margin: 1em 0; }
      th, td { border: 1px solid #999; padding: 6px 8px; }
      th { background-color: #e8e8e8; font-weight: bold; }
      img { max-width: 100%; height: auto; }
      blockquote { border-left: 3px solid #ccc; margin: 1em 0; padding-left: 1em; color: #555; }
    </style>
  `;

  const escapedTitle = escapeHtml(metadata.title);
  const escapedAuthor = escapeHtml(metadata.author || "PDF Accessibility Converter");
  const escapedLang = escapeHtml(metadata.lang);

  const titleTag = `<title>${escapedTitle}</title>`;
  const metaTags = `
    <meta charset="utf-8">
    <meta name="author" content="${escapedAuthor}">
  `;

  let result = html;

  if (!result.includes("<html")) {
    result = `<!DOCTYPE html><html lang="${escapedLang}"><head>${metaTags}${titleTag}${printCss}</head><body>${result}</body></html>`;
  } else {
    const langRegex = /(<html[^>]*)\slang=["'][^"']*["']/i;
    if (langRegex.test(result)) {
      result = result.replace(langRegex, `$1 lang="${escapedLang}"`);
    } else {
      result = result.replace(/<html/i, `<html lang="${escapedLang}"`);
    }

    const headClose = result.indexOf("</head>");
    if (headClose !== -1) {
      if (!/<title[^>]*>/i.test(result)) {
        result = result.slice(0, headClose) + titleTag + metaTags + printCss + result.slice(headClose);
      } else {
        result = result.slice(0, headClose) + metaTags + printCss + result.slice(headClose);
      }
    }
  }

  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

---

## 4. ACCESSIBILITY ENGINE — Multiple changes

### 4a. Replace `buildStructuralSummary` (removes row/table limits)

```typescript
function buildStructuralSummary(
  images: ExtractedImage[],
  tables: ExtractedTable[]
): string {
  const parts: string[] = [];

  if (images.length > 0) {
    parts.push(`\n--- EXTRACTED IMAGES (${images.length} found) ---`);
    for (const img of images.slice(0, 20)) {
      parts.push(
        `Image "${img.name}" on page ${img.pageNumber}: ${img.width}x${img.height}px`
      );
    }
    parts.push(
      "CRITICAL: You MUST include an <img> tag for EVERY image listed above. " +
      "EVERY <img> MUST have a non-empty alt attribute with meaningful descriptive text. " +
      "IMPORTANT: Set the src attribute to exactly the image name (e.g. src=\"ImageName\"). " +
      "Do NOT skip any images. Do NOT omit alt text."
    );
  }

  if (tables.length > 0) {
    parts.push(`\n--- EXTRACTED TABLES (${tables.length} found) ---`);
    parts.push(
      "CRITICAL: You MUST reproduce EVERY table below with ALL rows and ALL cell content. " +
      "Do NOT summarize, truncate, or skip any rows or cells. Include every single piece of data."
    );
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      parts.push(`\nTable ${i + 1} on page ${table.pageNumber} (${table.rows.length} rows):`);
      for (const row of table.rows) {
        parts.push(`  | ${row.join(" | ")} |`);
      }
    }
    parts.push(
      "\nFor EVERY table above, generate proper HTML <table> with <thead>/<tbody>, <th> with scope attributes, and <caption>. " +
      "Include ALL rows — do NOT omit any data."
    );
  }

  return parts.join("\n");
}
```

### 4b. Update `runAiAudit` — increase chunk size to 15K

Change the html substring from 6000 to 15000:

```typescript
async function runAiAudit(html: string): Promise<ComplianceIssue[]> {
  const AI_AUDIT_CHUNK_SIZE = 15000;
  const htmlToAudit = html.length > AI_AUDIT_CHUNK_SIZE ? html.substring(0, AI_AUDIT_CHUNK_SIZE) : html;
  // ... rest stays the same but use htmlToAudit instead of html.substring(0, 6000)
```

### 4c. Add new types and functions BEFORE `generateAccessibleDocument`

```typescript
export type ProgressCallback = (message: string) => Promise<void>;

interface PageChunk {
  text: string;
  startPage: number;
  endPage: number;
}

function splitTextByPages(text: string, maxChunkSize: number = 8000): PageChunk[] {
  const pageBreakRegex = /(?:^|\n)(?:[-=]{3,}|Page\s+\d+|---\s*Page\s*\d+\s*---|\f)/gi;
  const parts: { pageNum: number; text: string }[] = [];
  let lastIdx = 0;
  let currentPage = 1;
  let match: RegExpExecArray | null;

  const regex = new RegExp(pageBreakRegex.source, "gi");
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ pageNum: currentPage, text: text.slice(lastIdx, match.index) });
    }
    currentPage++;
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) {
    parts.push({ pageNum: currentPage, text: text.slice(lastIdx) });
  }
  if (parts.length === 0) {
    parts.push({ pageNum: 1, text });
  }

  const chunks: PageChunk[] = [];
  let currentChunk = "";
  let chunkStartPage = parts[0]?.pageNum ?? 1;

  for (const part of parts) {
    if (currentChunk.length + part.text.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        startPage: chunkStartPage,
        endPage: part.pageNum - 1,
      });
      currentChunk = part.text;
      chunkStartPage = part.pageNum;
    } else {
      currentChunk += (currentChunk ? "\n" : "") + part.text;
    }
  }
  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk.trim(),
      startPage: chunkStartPage,
      endPage: parts[parts.length - 1]?.pageNum ?? 1,
    });
  }

  return chunks;
}

function filterImagesForChunk(images: ExtractedImage[], startPage: number, endPage: number): ExtractedImage[] {
  return images.filter((img) => img.pageNumber >= startPage && img.pageNumber <= endPage);
}

function filterTablesForChunk(tables: ExtractedTable[], startPage: number, endPage: number): ExtractedTable[] {
  return tables.filter((t) => t.pageNumber >= startPage && t.pageNumber <= endPage);
}

function tableContentSignature(rows: string[][]): string {
  return rows.map((r) => r.map((c) => c.trim().toLowerCase().replace(/\s+/g, " ")).join("|")).join("||");
}

function ensureMissingTables(html: string, tables: ExtractedTable[]): string {
  if (tables.length === 0) return html;

  const existingTableRegex = /<table[\s\S]*?<\/table>/gi;
  const existingTables = html.match(existingTableRegex) || [];
  const existingSignatures = new Set<string>();

  for (const tHtml of existingTables) {
    const rowMatches = tHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const rows: string[][] = [];
    for (const rowHtml of rowMatches) {
      const cells: string[] = [];
      const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]*>/g, "").trim());
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) {
      existingSignatures.add(tableContentSignature(rows));
    }
  }

  const missingTables = tables.filter((t) => !existingSignatures.has(tableContentSignature(t.rows)));
  if (missingTables.length === 0) return html;

  const tableSections = missingTables
    .map((t, i) => {
      const headerRow = t.rows[0] || [];
      const bodyRows = t.rows.slice(1);
      const thead = `<thead><tr>${headerRow.map((c) => `<th scope="col">${escapeHtmlText(c)}</th>`).join("")}</tr></thead>`;
      const tbody = bodyRows.length > 0
        ? `<tbody>${bodyRows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtmlText(c)}</td>`).join("")}</tr>`).join("")}</tbody>`
        : "";
      return `<table><caption>Table from page ${t.pageNumber}</caption>${thead}${tbody}</table>`;
    })
    .join("\n");

  const sectionHtml = `\n<section aria-label="Additional tables">\n<h2>Additional Tables</h2>\n${tableSections}\n</section>`;

  const bodyCloseIdx = html.lastIndexOf("</body>");
  if (bodyCloseIdx !== -1) {
    return html.slice(0, bodyCloseIdx) + sectionHtml + "\n" + html.slice(bodyCloseIdx);
  }
  const mainCloseIdx = html.lastIndexOf("</main>");
  if (mainCloseIdx !== -1) {
    return html.slice(0, mainCloseIdx) + sectionHtml + "\n" + html.slice(mainCloseIdx);
  }
  return html + sectionHtml;
}

function mergeChunksIntoDocument(
  chunks: string[],
  metadata: { title?: string; author?: string; subject?: string }
): string {
  if (chunks.length === 1) return chunks[0];

  const bodyContents: string[] = [];
  let headContent = "";
  let lang = "en";

  for (const chunk of chunks) {
    const langMatch = chunk.match(/<html[^>]*\slang=["']([^"']+)["']/i);
    if (langMatch) lang = langMatch[1];

    const headMatch = chunk.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    if (headMatch && !headContent) headContent = headMatch[1];

    const bodyMatch = chunk.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      bodyContents.push(bodyMatch[1]);
    } else {
      const cleaned = chunk
        .replace(/<!DOCTYPE[^>]*>/i, "")
        .replace(/<html[^>]*>/i, "")
        .replace(/<\/html>/i, "")
        .replace(/<head[^>]*>[\s\S]*?<\/head>/i, "")
        .replace(/<body[^>]*>/i, "")
        .replace(/<\/body>/i, "")
        .trim();
      if (cleaned) bodyContents.push(cleaned);
    }
  }

  const documentTitle = metadata.title || "Accessible Document";
  if (!headContent) {
    headContent = `<meta charset="utf-8"><title>${escapeHtmlText(documentTitle)}</title>`;
  }

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
${headContent}
</head>
<body>
<main id="main-content">
${bodyContents.join("\n\n<hr aria-hidden=\"true\">\n\n")}
</main>
</body>
</html>`;
}
```

### 4d. Update `generateAccessibleDocument` signature and body

New signature:
```typescript
export async function generateAccessibleDocument(
  extractedText: string,
  originalFilename: string,
  metadata: { title?: string; author?: string; subject?: string },
  images: ExtractedImage[] = [],
  tables: ExtractedTable[] = [],
  pageCount?: number,
  onProgress?: ProgressCallback
): Promise<AccessibilityResult> {
```

Replace the full function body — see the complete function in section 4c above or copy from:
`server/lib/accessibility-engine.ts` lines 718-844

Key changes in the body:
- Chunks text via `splitTextByPages(extractedText, 8000)`
- Loops through chunks, filtering images/tables per chunk
- Uses `continuationSystemPrompt` for chunks after the first
- Calls `ensureMissingTables()` on each chunk
- Merges chunks via `mergeChunksIntoDocument()`
- Calls `onProgress` at each step
- Table rule #4 now says "you MUST reproduce EVERY table with ALL rows"

---

## 5. DOCX BUILDER — Rowspan support & error handling

### 5a. Add imports

```typescript
import {
  // ... existing imports ...
  VerticalMergeType,
  ShadingType,
} from "docx";
```

### 5b. Add `safePlainText` function (before `processTable`)

```typescript
function safePlainText(el: HTMLElement): string {
  try {
    return sanitizeXmlText(el.textContent || "");
  } catch {
    return "";
  }
}
```

### 5c. Replace `processTable` with grid-based rowspan/colspan version

```typescript
function processTable(el: HTMLElement): Table | null {
  const rows: TableRow[] = [];
  const tableRows = el.querySelectorAll("tr");
  if (tableRows.length === 0) return null;

  let gridColCount = 0;
  for (const tr of tableRows) {
    const cells = tr.querySelectorAll("th, td");
    let rowCols = 0;
    for (const cell of cells) {
      rowCols += parseInt(cell.getAttribute("colspan") || "1", 10) || 1;
    }
    if (rowCols > gridColCount) gridColCount = rowCols;
  }
  if (gridColCount === 0) return null;

  const grid: (boolean)[][] = [];
  for (let r = 0; r < tableRows.length; r++) {
    grid[r] = new Array(gridColCount).fill(false);
  }

  for (let rowIdx = 0; rowIdx < tableRows.length; rowIdx++) {
    const tr = tableRows[rowIdx];
    const cells = tr.querySelectorAll("th, td");
    const tableCells: TableCell[] = [];
    let cellIdx = 0;
    let colPos = 0;

    while (colPos < gridColCount) {
      if (grid[rowIdx][colPos]) {
        tableCells.push(
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "" })] })],
            verticalMerge: VerticalMergeType.CONTINUE,
          })
        );
        colPos++;
        continue;
      }

      if (cellIdx >= cells.length) {
        tableCells.push(
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "" })] })],
          })
        );
        colPos++;
        continue;
      }

      const cell = cells[cellIdx];
      const isHeader = cell.tagName?.toLowerCase() === "th";
      const colSpan = Math.min(
        parseInt(cell.getAttribute("colspan") || "1", 10) || 1,
        gridColCount - colPos
      );
      const rowSpan = parseInt(cell.getAttribute("rowspan") || "1", 10) || 1;

      if (rowSpan > 1) {
        for (let dr = 1; dr < rowSpan && rowIdx + dr < tableRows.length; dr++) {
          for (let dc = 0; dc < colSpan && colPos + dc < gridColCount; dc++) {
            grid[rowIdx + dr][colPos + dc] = true;
          }
        }
      }

      let inlineChildren: InlineChild[];
      try {
        inlineChildren = extractInlineChildren(cell);
      } catch {
        const fallback = safePlainText(cell);
        inlineChildren = fallback ? [new TextRun({ text: fallback })] : [];
      }

      tableCells.push(
        new TableCell({
          children: [
            new Paragraph({
              children: inlineChildren.length > 0 ? inlineChildren : [new TextRun({ text: "" })],
            }),
          ],
          shading: isHeader
            ? { type: ShadingType.SOLID, fill: "E8E8E8", color: "E8E8E8" }
            : undefined,
          columnSpan: colSpan > 1 ? colSpan : undefined,
          verticalMerge: rowSpan > 1 ? VerticalMergeType.RESTART : undefined,
        })
      );

      colPos += colSpan;
      cellIdx++;
    }

    const hasHeaderCells = cells[0]?.tagName?.toLowerCase() === "th";
    rows.push(new TableRow({ children: tableCells, tableHeader: hasHeaderCells || undefined }));
  }

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}
```

### 5d. Wrap `processElement` in try/catch

```typescript
function processElement(el: HTMLElement): (Paragraph | Table)[] {
  try {
    return processElementInner(el);
  } catch {
    const fallback = safePlainText(el);
    if (fallback) {
      return [new Paragraph({ children: [new TextRun({ text: fallback })] })];
    }
    return [];
  }
}

// Rename the existing processElement function to processElementInner:
function processElementInner(el: HTMLElement): (Paragraph | Table)[] {
  // ... all the existing processElement body stays the same ...
}
```

---

## 6. ROUTES — PDF download endpoint + statusMessage

### 6a. Add the download-pdf route

```typescript
app.get("/api/conversions/:id/download-pdf", optionalAuth, async (req, res) => {
  const userId = getUserId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [conversion] = await db
    .select({
      accessibleHtml: conversions.accessibleHtml,
      originalFilename: conversions.originalFilename,
      status: conversions.status,
      updatedAt: conversions.updatedAt,
    })
    .from(conversions)
    .where(conversionOwnerFilter(id, userId));

  if (!conversion) { res.status(404).json({ error: "Conversion not found" }); return; }
  if (conversion.status !== "completed" || !conversion.accessibleHtml) {
    res.status(400).json({ error: "Accessible HTML is not yet available" }); return;
  }

  let html = conversion.accessibleHtml;
  const updatedDate = conversion.updatedAt ? new Date(conversion.updatedAt) : new Date();
  const isoDate = updatedDate.toISOString();
  const readableDate = updatedDate.toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  });

  const metaTag = `<meta name="date" content="${isoDate}">`;
  const headCloseIdx = html.indexOf("</head>");
  if (headCloseIdx !== -1) {
    html = html.slice(0, headCloseIdx) + `  ${metaTag}\n` + html.slice(headCloseIdx);
  }

  const timestampFooter = `\n<footer style="margin-top:2rem;padding:1rem 0;border-top:1px solid #e0e0e0;font-size:0.85rem;color:#666;text-align:center;" role="contentinfo" aria-label="Document timestamp">\n  <p>This accessible document was last updated on ${readableDate}</p>\n</footer>`;
  const bodyCloseIdx = html.lastIndexOf("</body>");
  if (bodyCloseIdx !== -1) {
    html = html.slice(0, bodyCloseIdx) + timestampFooter + "\n" + html.slice(bodyCloseIdx);
  }

  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  const docTitle = titleMatch ? titleMatch[1] : conversion.originalFilename.replace(/\.pdf$/i, "");
  const langMatch = html.match(/<html[^>]*\slang=["']([^"']+)["']/i);
  const docLang = langMatch ? langMatch[1] : "en";
  const authorMatch = html.match(/<meta\s+name=["']author["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']author["']/i);
  const docAuthor = authorMatch ? authorMatch[1] : "PDF Accessibility Converter";

  try {
    const { buildPdf } = await import("./lib/pdf-builder");
    const pdfBuffer = await buildPdf(html, {
      title: docTitle,
      lang: docLang,
      author: docAuthor,
    });

    const filename = conversion.originalFilename.replace(/\.pdf$/i, "").replace(/[^\w\s.-]/g, "_") + "-accessible.pdf";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (err) {
    console.error("PDF conversion error:", err);
    res.status(500).json({ error: "Failed to generate PDF file" });
  }
});
```

### 6b. Update the process route

In the process route, add `statusMessage` to the initial status update:
```typescript
.set({ status: "processing", statusMessage: "Starting conversion…", updatedAt: new Date() })
```

Add the `updateStatusMessage` callback function after the initial response:
```typescript
const updateStatusMessage = async (message: string) => {
  try {
    await db
      .update(conversions)
      .set({ statusMessage: message, updatedAt: new Date() })
      .where(eq(conversions.id, id));
  } catch (e) {
    console.error("Failed to update status message:", e);
  }
};
```

Add progress calls before each stage:
```typescript
await updateStatusMessage("Extracting PDF content…");
// ... extraction code ...
await updateStatusMessage("Running OCR on scanned pages…");
// ... OCR code ...
await updateStatusMessage("Evaluating original document…");
// ... evaluation code ...
```

Pass `pageCount` and `updateStatusMessage` to `generateAccessibleDocument`:
```typescript
const result = await generateAccessibleDocument(
  finalText,
  conversion.originalFilename,
  extraction.metadata,
  extraction.images,
  extraction.tables,
  extraction.pageCount,
  updateStatusMessage
);
```

Clear statusMessage on completion and failure:
```typescript
// On completion:
.set({ status: "completed", statusMessage: null, ... })
// On failure:
.set({ status: "failed", statusMessage: null, ... })
```

### 6c. Add `statusMessage` to the GET route select

```typescript
statusMessage: conversions.statusMessage,
```

---

## 7. FRONTEND — Download PDF button + progress display

### 7a. Add state and handler

```typescript
const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

const handleDownloadPdf = async () => {
  setIsDownloadingPdf(true);
  try {
    const resp = await fetch(`/api/conversions/${numericId}/download-pdf`, { credentials: "include" });
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({ error: "PDF generation failed" }));
      toast({ title: "Download failed", description: errData.error || "Could not generate PDF", variant: "destructive" });
      return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = conversion.originalFilename.replace(/\.pdf$/i, "") + "-accessible.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    toast({ title: "Download failed", description: "An unexpected error occurred generating the PDF", variant: "destructive" });
  } finally {
    setIsDownloadingPdf(false);
  }
};
```

### 7b. Add the Download PDF button (next to Download Word)

```tsx
<button onClick={handleDownloadPdf} disabled={isDownloadingPdf} className="inline-flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-800 text-white rounded-xl text-sm font-bold shadow-sm shadow-red-700/20 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none" data-testid="button-download-pdf">
  {isDownloadingPdf ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <FileCheck2 className="w-4 h-4" aria-hidden="true" />}
  Download PDF
</button>
```

### 7c. Add statusMessage display in the processing section

Inside the processing status area (where `status === "processing"`), add:

```tsx
{conversion.statusMessage && (
  <p className="mt-3 text-sm font-medium text-primary text-center" data-testid="text-status-message" aria-live="polite">
    {conversion.statusMessage}
  </p>
)}
```

### 7d. Fix WCAG badge text visibility

Any element using `bg-secondary` as a full background needs `text-secondary-foreground`:

```tsx
<span className="text-xs font-mono bg-secondary text-secondary-foreground px-2 py-0.5 rounded font-bold">
  WCAG {issue.criterion} ({issue.level})
</span>
```

---

## Summary of Steps on the Other Replit

1. Add `statusMessage` to schema + run the ALTER TABLE SQL
2. Install `puppeteer-core` + system chromium
3. Create `pdf-builder.ts` (new file)
4. Update `accessibility-engine.ts` (buildStructuralSummary, runAiAudit, add chunking functions, update generateAccessibleDocument)
5. Update `docx-builder.ts` (imports, safePlainText, processTable with rowspan, processElement try/catch)
6. Update routes (download-pdf endpoint, statusMessage in process route, statusMessage in GET select)
7. Update frontend (Download PDF button, statusMessage display, text visibility fix)
8. Restart the API server
