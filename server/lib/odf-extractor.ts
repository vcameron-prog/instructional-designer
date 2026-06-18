import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import type { PdfExtraction, ExtractedTable } from "./pdf-processor";

const NS_TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const NS_TABLE = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
const NS_DC = "http://purl.org/dc/elements/1.1/";
const NS_META = "urn:oasis:names:tc:opendocument:xmlns:meta:1.0";

function getNodesByNS(
  parent: Element | Document,
  ns: string,
  localName: string,
): Element[] {
  const col = parent.getElementsByTagNameNS(ns, localName);
  const result: Element[] = [];
  for (let i = 0; i < col.length; i++) {
    const node = col.item(i);
    if (node) result.push(node as Element);
  }
  return result;
}

function nodeTextContent(node: Element): string {
  return node.textContent ?? "";
}

function extractTextFromContentXml(
  doc: Document,
  format: "odt" | "ods" | "odp",
): { paragraphs: string[]; tables: ExtractedTable[] } {
  const paragraphs: string[] = [];
  const tables: ExtractedTable[] = [];

  if (format === "ods") {
    // Spreadsheet: iterate sheets (table:table) → rows → cells
    const sheets = getNodesByNS(doc, NS_TABLE, "table");
    sheets.forEach((sheet, sheetIdx) => {
      const sheetName =
        (sheet as Element).getAttributeNS
          ? (sheet as any).getAttribute("table:name") || `Sheet ${sheetIdx + 1}`
          : `Sheet ${sheetIdx + 1}`;

      const rows: string[][] = [];
      const trNodes = getNodesByNS(sheet, NS_TABLE, "table-row");
      for (const tr of trNodes) {
        const cells: string[] = [];
        const cellNodes = getNodesByNS(tr, NS_TABLE, "table-cell");
        for (const cell of cellNodes) {
          const pNodes = getNodesByNS(cell, NS_TEXT, "p");
          const cellText = pNodes.map(nodeTextContent).join(" ").trim();
          cells.push(cellText);
        }
        if (cells.some((c) => c.length > 0)) {
          rows.push(cells);
        }
      }
      if (rows.length > 0) {
        tables.push({ pageNumber: sheetIdx + 1, rows });
        paragraphs.push(
          `[Sheet: ${sheetName}]\n${rows.map((r) => r.join("\t")).join("\n")}`,
        );
      }
    });
  } else if (format === "odp") {
    // Presentation: iterate draw:page elements (slides)
    const NS_DRAW = "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0";
    const slides = getNodesByNS(doc as unknown as Document, NS_DRAW, "page");
    slides.forEach((slide, slideIdx) => {
      const slideParts: string[] = [`--- Slide ${slideIdx + 1} ---`];
      const pNodes = getNodesByNS(slide, NS_TEXT, "p");
      for (const p of pNodes) {
        const t = nodeTextContent(p).trim();
        if (t) slideParts.push(t);
      }

      // Tables in slides
      const tblNodes = getNodesByNS(slide, NS_TABLE, "table");
      for (const tbl of tblNodes) {
        const rows: string[][] = [];
        const trNodes = getNodesByNS(tbl, NS_TABLE, "table-row");
        for (const tr of trNodes) {
          const cells: string[] = [];
          const cellNodes = getNodesByNS(tr, NS_TABLE, "table-cell");
          for (const cell of cellNodes) {
            const pCells = getNodesByNS(cell, NS_TEXT, "p");
            cells.push(pCells.map(nodeTextContent).join(" ").trim());
          }
          if (cells.some((c) => c.length > 0)) rows.push(cells);
        }
        if (rows.length > 0) {
          tables.push({ pageNumber: slideIdx + 1, rows });
        }
      }

      paragraphs.push(slideParts.join("\n"));
    });
  } else {
    // ODT: paragraph text
    const pNodes = getNodesByNS(doc, NS_TEXT, "p");
    for (const p of pNodes) {
      const t = nodeTextContent(p).trim();
      if (t) paragraphs.push(t);
    }

    // Headings — include as paragraphs in reading order
    const hNodes = getNodesByNS(doc, NS_TEXT, "h");
    for (const h of hNodes) {
      const t = nodeTextContent(h).trim();
      if (t) paragraphs.push(t);
    }

    // Tables
    const tblNodes = getNodesByNS(doc, NS_TABLE, "table");
    for (const tbl of tblNodes) {
      const rows: string[][] = [];
      const trNodes = getNodesByNS(tbl, NS_TABLE, "table-row");
      for (const tr of trNodes) {
        const cells: string[] = [];
        const cellNodes = getNodesByNS(tr, NS_TABLE, "table-cell");
        for (const cell of cellNodes) {
          const pCells = getNodesByNS(cell, NS_TEXT, "p");
          cells.push(pCells.map(nodeTextContent).join(" ").trim());
        }
        if (cells.some((c) => c.length > 0)) rows.push(cells);
      }
      if (rows.length > 0) tables.push({ pageNumber: 1, rows });
    }
  }

  return { paragraphs, tables };
}

export async function extractOdfContent(
  buffer: Buffer,
  format: "odt" | "ods" | "odp",
): Promise<PdfExtraction> {
  const zip = await JSZip.loadAsync(buffer);

  const contentFile = zip.file("content.xml");
  if (!contentFile) {
    throw new Error(`No content.xml found in ODF archive (${format.toUpperCase()})`);
  }

  const contentXml = await contentFile.async("string");
  const parser = new DOMParser();
  const doc = parser.parseFromString(contentXml, "text/xml");

  const { paragraphs, tables } = extractTextFromContentXml(doc as unknown as Document, format);

  // Try to read metadata
  let title: string | undefined;
  let author: string | undefined;
  const metaFile = zip.file("meta.xml");
  if (metaFile) {
    try {
      const metaXml = await metaFile.async("string");
      const metaDoc = parser.parseFromString(metaXml, "text/xml");
      const titleNodes = getNodesByNS(metaDoc as unknown as Document, NS_DC, "title");
      const creatorNodes = getNodesByNS(metaDoc as unknown as Document, NS_DC, "creator");
      title = titleNodes[0] ? nodeTextContent(titleNodes[0]).trim() : undefined;
      author = creatorNodes[0] ? nodeTextContent(creatorNodes[0]).trim() : undefined;
    } catch {
      // metadata not critical
    }
  }

  const text = paragraphs.join("\n\n").trim();
  const lineCount = paragraphs.length;
  const estimatedPages = Math.max(1, Math.ceil(lineCount / 30));

  return {
    text,
    pageCount: estimatedPages,
    metadata: {
      ...(title ? { title } : {}),
      ...(author ? { author } : {}),
    },
    images: [],
    tables,
  };
}
