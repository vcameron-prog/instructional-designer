import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  ExternalHyperlink,
  Packer,
  AlignmentType,
  BorderStyle,
  WidthType,
  Footer,
  PageNumber,
  UnderlineType,
  LevelFormat,
  VerticalMergeType,
  ShadingType,
} from "docx";
import { parse, HTMLElement, TextNode, NodeType } from "node-html-parser";

const HEADING_MAP: Record<
  string,
  (typeof HeadingLevel)[keyof typeof HeadingLevel]
> = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
  h5: HeadingLevel.HEADING_5,
  h6: HeadingLevel.HEADING_6,
};

const LIST_TAGS = new Set(["ul", "ol"]);
const SKIP_IN_TEXT_EXTRACTION = new Set(["ul", "ol", "table", "img", "figure"]);

function sanitizeXmlText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[\uFFFE\uFFFF]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

interface TextStyle {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  superScript?: boolean;
  subScript?: boolean;
}

type InlineChild = TextRun | ExternalHyperlink;

function decodeBase64Image(
  dataUrl: string,
): { data: Buffer; width: number; height: number } | null {
  const match = dataUrl.match(
    /^data:image\/(png|jpeg|jpg|gif|bmp|webp);base64,(.+)$/i,
  );
  if (!match) return null;
  const data = Buffer.from(match[2], "base64");
  return { data, width: 400, height: 300 };
}

function extractInlineChildren(
  node: HTMLElement | TextNode,
  style: TextStyle = {},
): InlineChild[] {
  if (node.nodeType === NodeType.TEXT_NODE) {
    const text = sanitizeXmlText((node as TextNode).rawText);
    const normalizedText = text.replace(/\s+/g, " ");
    if (!normalizedText.trim()) return [];
    return [
      new TextRun({
        text: normalizedText,
        bold: style.bold,
        italics: style.italics,
        underline: style.underline ? { type: UnderlineType.SINGLE } : undefined,
        strike: style.strike,
        superScript: style.superScript,
        subScript: style.subScript,
      }),
    ];
  }

  const el = node as HTMLElement;
  const tag = el.tagName?.toLowerCase();

  if (SKIP_IN_TEXT_EXTRACTION.has(tag)) return [];

  if (tag === "br") {
    return [new TextRun({ text: "", break: 1 })];
  }

  if (tag === "a") {
    const href = el.getAttribute("href") || "";
    const linkText = sanitizeXmlText(el.textContent || href);
    if (href && linkText) {
      return [
        new ExternalHyperlink({
          children: [new TextRun({ text: linkText, style: "Hyperlink" })],
          link: href,
        }),
      ];
    }
    return [new TextRun({ text: linkText || "" })];
  }

  const newStyle = { ...style };
  if (tag === "strong" || tag === "b") newStyle.bold = true;
  if (tag === "em" || tag === "i") newStyle.italics = true;
  if (tag === "u") newStyle.underline = true;
  if (tag === "s" || tag === "del" || tag === "strike") newStyle.strike = true;
  if (tag === "sup") newStyle.superScript = true;
  if (tag === "sub") newStyle.subScript = true;

  const children: InlineChild[] = [];
  for (const child of el.childNodes) {
    children.push(
      ...extractInlineChildren(child as HTMLElement | TextNode, newStyle),
    );
  }
  return children;
}

function processImage(el: HTMLElement): Paragraph | null {
  const src = el.getAttribute("src") || "";
  const alt = el.getAttribute("alt") || "";

  const imgData = decodeBase64Image(src);
  if (!imgData) return null;

  return new Paragraph({
    children: [
      new ImageRun({
        data: imgData.data,
        transformation: { width: imgData.width, height: imgData.height },
        altText: {
          title: alt || "Image",
          description: alt || "Embedded image",
          name: alt || "image",
        },
      }),
    ],
    spacing: { after: 200 },
  });
}

function safePlainText(el: HTMLElement): string {
  try {
    return sanitizeXmlText(el.textContent || "");
  } catch {
    return "";
  }
}

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

  const grid: boolean[][] = [];
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
            children: [
              new Paragraph({ children: [new TextRun({ text: "" })] }),
            ],
            verticalMerge: VerticalMergeType.CONTINUE,
          }),
        );
        colPos++;
        continue;
      }

      if (cellIdx >= cells.length) {
        tableCells.push(
          new TableCell({
            children: [
              new Paragraph({ children: [new TextRun({ text: "" })] }),
            ],
          }),
        );
        colPos++;
        continue;
      }

      const cell = cells[cellIdx];
      const isHeader = cell.tagName?.toLowerCase() === "th";
      const colSpan = Math.min(
        parseInt(cell.getAttribute("colspan") || "1", 10) || 1,
        gridColCount - colPos,
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
              children:
                inlineChildren.length > 0
                  ? inlineChildren
                  : [new TextRun({ text: "" })],
            }),
          ],
          shading: isHeader
            ? { type: ShadingType.SOLID, fill: "E8E8E8", color: "E8E8E8" }
            : undefined,
          columnSpan: colSpan > 1 ? colSpan : undefined,
          verticalMerge: rowSpan > 1 ? VerticalMergeType.RESTART : undefined,
        }),
      );

      colPos += colSpan;
      cellIdx++;
    }

    const hasHeaderCells = cells[0]?.tagName?.toLowerCase() === "th";
    rows.push(
      new TableRow({
        children: tableCells,
        tableHeader: hasHeaderCells || undefined,
      }),
    );
  }

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

function processListItems(
  el: HTMLElement,
  ordered: boolean,
  level: number = 0,
): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  for (const child of el.childNodes) {
    const childEl = child as HTMLElement;
    if (childEl.tagName?.toLowerCase() !== "li") continue;

    const inlineChildren = extractInlineChildren(childEl);

    if (inlineChildren.length > 0) {
      paragraphs.push(
        new Paragraph({
          children: inlineChildren,
          numbering: {
            reference: ordered ? "ordered-list" : "unordered-list",
            level: Math.min(level, 1),
          },
        }),
      );
    }

    for (const liChild of childEl.childNodes) {
      const liChildEl = liChild as HTMLElement;
      const liChildTag = liChildEl.tagName?.toLowerCase();
      if (liChildTag === "ul" || liChildTag === "ol") {
        paragraphs.push(
          ...processListItems(liChildEl, liChildTag === "ol", level + 1),
        );
      }
    }
  }

  return paragraphs;
}

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

function processElementInner(el: HTMLElement): (Paragraph | Table)[] {
  const tag = el.tagName?.toLowerCase();
  const results: (Paragraph | Table)[] = [];

  if (!tag) {
    if (el.nodeType === NodeType.TEXT_NODE) {
      const text = sanitizeXmlText(
        (el as unknown as TextNode).rawText?.trim() || "",
      );
      if (text) {
        results.push(new Paragraph({ children: [new TextRun({ text })] }));
      }
    }
    return results;
  }

  if (HEADING_MAP[tag]) {
    const children = extractInlineChildren(el);
    if (children.length > 0) {
      results.push(
        new Paragraph({
          children,
          heading: HEADING_MAP[tag],
          spacing: { before: 240, after: 120 },
        }),
      );
    }
    return results;
  }

  if (tag === "p") {
    const children: InlineChild[] = [];
    for (const child of el.childNodes) {
      const childEl = child as HTMLElement;
      if (childEl.tagName?.toLowerCase() === "img") {
        const imgPara = processImage(childEl);
        if (imgPara) results.push(imgPara);
      } else {
        children.push(
          ...extractInlineChildren(child as HTMLElement | TextNode),
        );
      }
    }
    if (children.length > 0) {
      results.push(new Paragraph({ children, spacing: { after: 200 } }));
    }
    return results;
  }

  if (tag === "ul" || tag === "ol") {
    results.push(...processListItems(el, tag === "ol"));
    return results;
  }

  if (tag === "table") {
    const table = processTable(el);
    if (table) results.push(table);
    return results;
  }

  if (tag === "img") {
    const imgPara = processImage(el);
    if (imgPara) results.push(imgPara);
    return results;
  }

  if (tag === "figure") {
    for (const child of el.childNodes) {
      const childEl = child as HTMLElement;
      const childTag = childEl.tagName?.toLowerCase();
      if (childTag === "img") {
        const imgPara = processImage(childEl);
        if (imgPara) results.push(imgPara);
      } else if (childTag === "figcaption") {
        const children = extractInlineChildren(childEl);
        if (children.length > 0) {
          results.push(
            new Paragraph({
              children,
              alignment: AlignmentType.CENTER,
              spacing: { after: 200 },
            }),
          );
        }
      } else if (childTag === "table") {
        const table = processTable(childEl);
        if (table) results.push(table);
      }
    }
    return results;
  }

  if (tag === "a") {
    const href = el.getAttribute("href") || "";
    const linkText = sanitizeXmlText(el.textContent || href);
    if (href && linkText) {
      results.push(
        new Paragraph({
          children: [
            new ExternalHyperlink({
              children: [new TextRun({ text: linkText, style: "Hyperlink" })],
              link: href,
            }),
          ],
        }),
      );
    }
    return results;
  }

  if (tag === "blockquote") {
    const children = extractInlineChildren(el);
    if (children.length > 0) {
      results.push(
        new Paragraph({
          children,
          indent: { left: 720 },
          spacing: { before: 200, after: 200 },
          border: {
            left: {
              style: BorderStyle.SINGLE,
              size: 6,
              color: "999999",
              space: 10,
            },
          },
        }),
      );
    }
    return results;
  }

  if (tag === "hr") {
    results.push(
      new Paragraph({
        children: [],
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
        },
        spacing: { before: 200, after: 200 },
      }),
    );
    return results;
  }

  if (tag === "pre") {
    const text = sanitizeXmlText(el.textContent || "");
    if (text.trim()) {
      const lines = text.split("\n");
      const runs: TextRun[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) runs.push(new TextRun({ text: "", break: 1 }));
        runs.push(
          new TextRun({ text: lines[i], font: "Courier New", size: 20 }),
        );
      }
      results.push(
        new Paragraph({
          children: runs,
          spacing: { before: 100, after: 100 },
        }),
      );
    }
    return results;
  }

  if (tag === "code") {
    const text = sanitizeXmlText(el.textContent || "");
    if (text.trim()) {
      results.push(
        new Paragraph({
          children: [new TextRun({ text, font: "Courier New", size: 20 })],
          spacing: { before: 100, after: 100 },
        }),
      );
    }
    return results;
  }

  if (tag === "footer") {
    const children = extractInlineChildren(el);
    if (children.length > 0) {
      results.push(
        new Paragraph({
          children: [],
          border: {
            top: { style: BorderStyle.SINGLE, size: 1, color: "E0E0E0" },
          },
          spacing: { before: 400 },
        }),
      );
      results.push(
        new Paragraph({
          children,
          alignment: AlignmentType.CENTER,
          spacing: { before: 100, after: 200 },
        }),
      );
    }
    return results;
  }

  if (
    tag === "div" ||
    tag === "section" ||
    tag === "article" ||
    tag === "main" ||
    tag === "aside" ||
    tag === "nav" ||
    tag === "header" ||
    tag === "span" ||
    tag === "details" ||
    tag === "summary"
  ) {
    for (const child of el.childNodes) {
      results.push(...processElement(child as HTMLElement));
    }
    return results;
  }

  const children = extractInlineChildren(el);
  if (children.length > 0) {
    results.push(new Paragraph({ children, spacing: { after: 200 } }));
  }

  return results;
}

export async function buildDocx(
  html: string,
  metadata: { title: string; filename: string; lang: string; author?: string },
): Promise<Buffer> {
  const root = parse(html);

  const body = root.querySelector("body");
  const contentRoot = body || root;

  const docChildren: (Paragraph | Table)[] = [];

  for (const child of contentRoot.childNodes) {
    docChildren.push(...processElement(child as HTMLElement));
  }

  if (docChildren.length === 0) {
    const textContent = sanitizeXmlText(contentRoot.textContent?.trim() || "");
    if (textContent) {
      docChildren.push(
        new Paragraph({ children: [new TextRun({ text: textContent })] }),
      );
    }
  }

  const doc = new Document({
    title: metadata.title,
    description: `Accessible version of ${metadata.filename}`,
    creator: metadata.author || "Accessibility Converter",
    language: metadata.lang,
    numbering: {
      config: [
        {
          reference: "ordered-list",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START,
            },
            {
              level: 1,
              format: LevelFormat.LOWER_LETTER,
              text: "%2.",
              alignment: AlignmentType.START,
            },
          ],
        },
        {
          reference: "unordered-list",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "\u2022",
              alignment: AlignmentType.START,
            },
            {
              level: 1,
              format: LevelFormat.BULLET,
              text: "\u25E6",
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {},
        children: docChildren,
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: "Page " }),
                  new TextRun({ children: [PageNumber.CURRENT] }),
                  new TextRun({ text: " — " }),
                  new TextRun({
                    text: metadata.title,
                    italics: true,
                    size: 18,
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}
