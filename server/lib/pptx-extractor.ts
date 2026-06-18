import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { inspectZip } from "./zip-guard";
import type { PdfExtraction, ExtractedTable } from "./pdf-processor";

const MAX_SLIDES = 200;
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";

function getChildElements(
  parent: { getElementsByTagNameNS: (ns: string, tag: string) => { length: number; item: (i: number) => unknown } },
  ns: string,
  tag: string,
): unknown[] {
  const col = parent.getElementsByTagNameNS(ns, tag);
  const result: unknown[] = [];
  for (let i = 0; i < col.length; i++) {
    const node = col.item(i);
    if (node) result.push(node);
  }
  return result;
}

function nodeText(node: unknown): string {
  return (node as { textContent?: string | null }).textContent ?? "";
}

function getAttr(node: unknown, name: string): string | null {
  return (node as { getAttribute?: (n: string) => string | null }).getAttribute?.(name) ?? null;
}

function extractSlideText(xml: string): { text: string; tables: string[][] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");

  const tables: string[][] = [];

  // Extract tables: <a:tbl> → <a:tr> → <a:tc>
  const tblNodes = getChildElements(doc, NS_A, "tbl");
  for (const tbl of tblNodes) {
    const rowNodes = getChildElements(tbl as Parameters<typeof getChildElements>[0], NS_A, "tr");
    for (const row of rowNodes) {
      const cellNodes = getChildElements(row as Parameters<typeof getChildElements>[0], NS_A, "tc");
      const cells: string[] = [];
      for (const cell of cellNodes) {
        const tNodes = getChildElements(cell as Parameters<typeof getChildElements>[0], NS_A, "t");
        const cellText = tNodes.map(nodeText).join("").trim();
        cells.push(cellText);
      }
      if (cells.some((c) => c.length > 0)) {
        tables.push(cells);
      }
    }
  }

  // Extract all paragraph text: <a:p> → <a:t>
  const paragraphNodes = getChildElements(doc, NS_A, "p");
  const paragraphs: string[] = [];
  for (const p of paragraphNodes) {
    const tNodes = getChildElements(p as Parameters<typeof getChildElements>[0], NS_A, "t");
    const paraText = tNodes.map(nodeText).join("").trim();
    if (paraText) paragraphs.push(paraText);
  }

  return { text: paragraphs.join("\n"), tables };
}

function slideNumber(filename: string): number {
  const m = filename.match(/(\d+)\.xml$/i);
  return m ? parseInt(m[1], 10) : 0;
}

export async function extractPptxContent(
  buffer: Buffer,
): Promise<PdfExtraction> {
  inspectZip(buffer, "PPTX");

  const zip = await JSZip.loadAsync(buffer);

  // Collect slide files sorted by slide number
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b))
    .slice(0, MAX_SLIDES);

  if (slideFiles.length === 0) {
    throw new Error("No slides found in PPTX file.");
  }

  // Collect notes files indexed by slide number
  const notesMap = new Map<number, string>();
  const notesFiles = Object.keys(zip.files).filter((name) =>
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name),
  );
  for (const nf of notesFiles) {
    const num = slideNumber(nf);
    const xml = await zip.files[nf].async("string");
    notesMap.set(num, xml);
  }

  const textParts: string[] = [];
  const allTables: ExtractedTable[] = [];

  for (let idx = 0; idx < slideFiles.length; idx++) {
    const slideNum = slideNumber(slideFiles[idx]);
    const slideXml = await zip.files[slideFiles[idx]].async("string");
    const { text, tables } = extractSlideText(slideXml);

    const parts: string[] = [`--- Slide ${slideNum} ---`];
    if (text) parts.push(text);

    // Append speaker notes if present
    const notesXml = notesMap.get(slideNum);
    if (notesXml) {
      const { text: notesText } = extractSlideText(notesXml);
      if (notesText) parts.push(`[Speaker notes: ${notesText}]`);
    }

    textParts.push(parts.join("\n"));

    // Each distinct slide's table rows become one ExtractedTable entry
    if (tables.length > 0) {
      allTables.push({ pageNumber: slideNum, rows: tables });
    }
  }

  const text = textParts.join("\n\n");

  return {
    text: text.trim(),
    pageCount: slideFiles.length,
    metadata: {},
    images: [],
    tables: allTables,
  };
}
