import JSZip from "jszip";
import { parse } from "node-html-parser";
import type { PdfExtraction, ExtractedTable } from "./pdf-processor";

/**
 * Parse the OPF container to find the path of the OPF package document.
 */
function findOpfPath(containerXml: string): string | null {
  const m = containerXml.match(/<rootfile[^>]+full-path="([^"]+)"/i);
  return m ? m[1] : null;
}

/**
 * Parse the OPF package document to get the spine reading order and manifest items.
 * Returns an array of href paths (relative to the OPF file directory) in reading order.
 */
function parseSpine(opfXml: string, opfDir: string): string[] {
  // Build manifest id → href map
  const manifestMap = new Map<string, string>();
  const itemRegex = /<item\s[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(opfXml)) !== null) {
    const tag = m[0];
    const idMatch = tag.match(/\bid="([^"]+)"/i);
    const hrefMatch = tag.match(/\bhref="([^"]+)"/i);
    const mediaMatch = tag.match(/\bmedia-type="([^"]+)"/i);
    if (!idMatch || !hrefMatch) continue;
    const mediaType = mediaMatch ? mediaMatch[1] : "";
    // Only include XHTML/HTML content documents
    if (
      mediaType.includes("xhtml") ||
      mediaType.includes("html") ||
      hrefMatch[1].match(/\.(xhtml|html|htm)$/i)
    ) {
      manifestMap.set(idMatch[1], hrefMatch[1]);
    }
  }

  // Parse spine itemrefs
  const spineMatch = opfXml.match(/<spine[\s\S]*?<\/spine>/i);
  const spineXml = spineMatch ? spineMatch[0] : "";
  const idrefRegex = /<itemref\s[^>]*idref="([^"]+)"/gi;
  const hrefs: string[] = [];
  let ir: RegExpExecArray | null;
  while ((ir = idrefRegex.exec(spineXml)) !== null) {
    const href = manifestMap.get(ir[1]);
    if (href) {
      // Resolve relative to OPF directory
      const resolved = opfDir ? `${opfDir}/${href}` : href;
      hrefs.push(resolved);
    }
  }

  return hrefs;
}

/**
 * Extract text and tables from an XHTML/HTML chapter string.
 */
function extractChapterContent(
  html: string,
  chapterIndex: number,
): { text: string; tables: ExtractedTable[] } {
  const root = parse(html);

  root.querySelectorAll("script, style").forEach((el) => el.remove());

  const tables: ExtractedTable[] = [];
  root.querySelectorAll("table").forEach((table) => {
    const rows: string[][] = [];
    table.querySelectorAll("tr").forEach((tr) => {
      const cells: string[] = [];
      tr.querySelectorAll("td, th").forEach((cell) => {
        cells.push((cell.textContent || "").trim());
      });
      if (cells.length > 0) rows.push(cells);
    });
    if (rows.length > 0) {
      tables.push({ pageNumber: chapterIndex + 1, rows });
    }
    table.replaceWith("");
  });

  const bodyEl = root.querySelector("body") ?? root;
  const text = (bodyEl.textContent ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n")
    .trim();

  return { text, tables };
}

export async function extractEpubContent(buffer: Buffer): Promise<PdfExtraction> {
  const zip = await JSZip.loadAsync(buffer);

  // Find the OPF file via META-INF/container.xml
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) {
    throw new Error("Not a valid EPUB: missing META-INF/container.xml");
  }
  const containerXml = await containerFile.async("string");
  const opfPath = findOpfPath(containerXml);
  if (!opfPath) {
    throw new Error("Not a valid EPUB: could not find OPF path in container.xml");
  }

  const opfFile = zip.file(opfPath);
  if (!opfFile) {
    throw new Error(`Not a valid EPUB: OPF file not found at ${opfPath}`);
  }
  const opfXml = await opfFile.async("string");

  // OPF directory (used to resolve relative hrefs)
  const opfDir = opfPath.includes("/") ? opfPath.split("/").slice(0, -1).join("/") : "";

  const chapterPaths = parseSpine(opfXml, opfDir);

  const textParts: string[] = [];
  const allTables: ExtractedTable[] = [];

  for (let i = 0; i < chapterPaths.length; i++) {
    const chPath = chapterPaths[i];
    // Try exact path, then decode URI
    const chFile = zip.file(chPath) ?? zip.file(decodeURIComponent(chPath));
    if (!chFile) continue;

    const chHtml = await chFile.async("string");
    const { text, tables } = extractChapterContent(chHtml, i);
    if (text) textParts.push(text);
    allTables.push(...tables);
  }

  // Extract title and author from OPF metadata
  let title: string | undefined;
  let author: string | undefined;
  const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
  const authorMatch = opfXml.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
  if (titleMatch) title = titleMatch[1].trim();
  if (authorMatch) author = authorMatch[1].trim();

  const text = textParts.join("\n\n").trim();

  return {
    text,
    pageCount: Math.max(1, chapterPaths.length),
    metadata: {
      ...(title ? { title } : {}),
      ...(author ? { author } : {}),
    },
    images: [],
    tables: allTables,
  };
}
