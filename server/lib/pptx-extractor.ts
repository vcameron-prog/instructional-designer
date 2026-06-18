import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { inspectZip } from "./zip-guard";
import type { PdfExtraction, ExtractedImage, ExtractedTable } from "./pdf-processor";

const MAX_SLIDES = 200;
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";

const SUPPORTED_IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

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

/**
 * Parse a slide relationships XML file and return a map of rId → media path
 * (relative to the ppt/ directory).
 */
function parseSlideRelationships(relsXml: string): Map<string, string> {
  const map = new Map<string, string>();
  const IMAGE_REL_TYPE =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

  // Match <Relationship Id="rId2" Type="...image..." Target="../media/image1.png"/>
  const relRegex = /<Relationship\s[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = relRegex.exec(relsXml)) !== null) {
    const tag = m[0];
    const idMatch = tag.match(/\bId="([^"]+)"/i);
    const typeMatch = tag.match(/\bType="([^"]+)"/i);
    const targetMatch = tag.match(/\bTarget="([^"]+)"/i);
    if (!idMatch || !typeMatch || !targetMatch) continue;
    if (!typeMatch[1].includes("image")) continue;
    if (typeMatch[1] !== IMAGE_REL_TYPE) continue;

    const rId = idMatch[1];
    // Target is like "../media/image1.png" — resolve relative to ppt/slides/
    const target = targetMatch[1].replace(/^\.\.\//, "ppt/");
    map.set(rId, target);
  }
  return map;
}

/**
 * Extract the rId values for all blip (image) references in a slide XML.
 * These appear as r:embed="rId2" on <a:blip> elements.
 */
function extractImageRidsFromSlide(slideXml: string): string[] {
  const rids: string[] = [];
  // Match <a:blip ... r:embed="rIdN" ...>
  const blipRegex = /<a:blip\s[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = blipRegex.exec(slideXml)) !== null) {
    const tag = m[0];
    const embedMatch = tag.match(/\br:embed="([^"]+)"/i);
    if (embedMatch) {
      rids.push(embedMatch[1]);
    }
  }
  return rids;
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
  const allImages: ExtractedImage[] = [];

  // Track already-extracted media to avoid duplicate alt-text calls for
  // the same image file appearing on multiple slides.
  const extractedMediaPaths = new Set<string>();

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

    // Extract images referenced in this slide
    const slideBaseName = slideFiles[idx].replace(/^ppt\/slides\//, "").replace(/\.xml$/i, "");
    const relsPath = `ppt/slides/_rels/${slideBaseName}.xml.rels`;

    if (zip.files[relsPath]) {
      const relsXml = await zip.files[relsPath].async("string");
      const relMap = parseSlideRelationships(relsXml);
      const rids = extractImageRidsFromSlide(slideXml);

      let imageIndexOnSlide = 0;
      for (const rId of rids) {
        const mediaPath = relMap.get(rId);
        if (!mediaPath || !zip.files[mediaPath]) continue;

        const ext = mediaPath.split(".").pop()?.toLowerCase() ?? "";
        const mimeType = SUPPORTED_IMAGE_TYPES[ext];
        if (!mimeType) continue; // skip unsupported formats (WMF, EMF, etc.)

        const mediaBase = mediaPath.split("/").pop() ?? mediaPath;
        imageIndexOnSlide++;

        // Use a unique name per slide+image so the AI can distinguish them
        const imageName = `slide${slideNum}_${mediaBase}`;

        // Only extract each media file once (deduplicate across slides by path)
        if (!extractedMediaPaths.has(mediaPath)) {
          extractedMediaPaths.add(mediaPath);
          const imageData = await zip.files[mediaPath].async("base64");
          const dataUrl = `data:${mimeType};base64,${imageData}`;

          allImages.push({
            pageNumber: slideNum,
            name: imageName,
            width: 400,
            height: 300,
            dataUrl,
          });
        } else {
          // Image already added; add a reference entry pointing to the same data
          // so the AI knows this slide also contains this image.
          const existing = allImages.find((img) =>
            img.name.endsWith(`_${mediaBase}`)
          );
          if (existing) {
            allImages.push({
              pageNumber: slideNum,
              name: imageName,
              width: existing.width,
              height: existing.height,
              dataUrl: existing.dataUrl,
            });
          }
        }
      }
    }
  }

  const text = textParts.join("\n\n");

  return {
    text: text.trim(),
    pageCount: slideFiles.length,
    metadata: {},
    images: allImages,
    tables: allTables,
  };
}
