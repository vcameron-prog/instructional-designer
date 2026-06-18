import type { PdfExtraction } from "./pdf-processor";

/**
 * Strip RTF markup and return plain text.
 * RTF is plain ASCII: control words start with `\`, groups are `{...}`.
 * We remove all control words/symbols and group delimiters, then decode
 * common RTF escape sequences (\'XX hex chars) to their UTF-8 equivalents.
 */
function stripRtf(rtf: string): string {
  // Remove the RTF header line
  let text = rtf;

  // Ignore embedded objects / pictures ({\*\objdata ...}, {\pict ...})
  // by removing them before general stripping
  text = text.replace(/\{\\(pict|object|objdata|objclass|objtime|objw|objh|rsidroot|datastore|datafield|bin\d*)[^}]*\}/gi, "");

  // Remove destination groups that contain binary/unneeded data
  text = text.replace(/\{\\\*[^}]*\}/g, "");

  // Decode RTF unicode escapes: \uN? (unicode codepoint + fallback char)
  text = text.replace(/\\u(\d+)\??/g, (_, n) => {
    const code = parseInt(n, 10);
    try {
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : "";
    } catch {
      return "";
    }
  });

  // Decode RTF hex escapes: \'XX  (Windows-1252 code points)
  text = text.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
    const code = parseInt(hex, 16);
    try {
      // Use a Windows-1252-like decode: for values < 0x80 and 0xa0-0xff
      // most map directly; 0x80-0x9f have special W1252 mappings
      const W1252: Record<number, number> = {
        0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e,
        0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
        0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
        0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
        0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
        0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
        0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
      };
      const mapped = W1252[code] ?? code;
      return String.fromCodePoint(mapped);
    } catch {
      return "";
    }
  });

  // Replace common RTF paragraph/line break control words with newlines
  text = text.replace(/\\(par|pard|line|page|sect|column)\b/g, "\n");
  // Tab
  text = text.replace(/\\tab\b/g, "\t");
  // Soft hyphen / optional hyphen
  text = text.replace(/\\-/g, "");
  // Non-breaking space
  text = text.replace(/\\~/g, "\u00a0");
  // En-dash, em-dash
  text = text.replace(/\\endash\b/g, "\u2013");
  text = text.replace(/\\emdash\b/g, "\u2014");
  // Bullets
  text = text.replace(/\\bullet\b/g, "\u2022");

  // Remove all remaining control words: \word or \word<N> (possibly followed by space)
  text = text.replace(/\\[a-zA-Z]+(-?\d+)? ?/g, "");

  // Remove control symbols (single non-alpha char after \, e.g. \*, \:, \;)
  text = text.replace(/\\[^a-zA-Z]/g, "");

  // Remove group delimiters
  text = text.replace(/[{}]/g, "");

  // Collapse excess whitespace
  text = text
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

export async function extractRtfContent(buffer: Buffer): Promise<PdfExtraction> {
  const raw = buffer.toString("latin1");
  const text = stripRtf(raw);

  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const estimatedPages = Math.max(1, Math.ceil(lines.length / 40));

  return {
    text,
    pageCount: estimatedPages,
    metadata: {},
    images: [],
    tables: [],
  };
}
