import { createRequire } from "module";
import type { PdfExtraction } from "./pdf-processor";

const require = createRequire(import.meta.url);

interface RtfSpan {
  value: string;
}

interface RtfParagraph {
  content: RtfSpan[];
}

interface RtfDocument {
  content: RtfParagraph[];
}

type ParseCallback = (err: Error | null, doc: RtfDocument) => void;

interface RtfParserModule {
  string: (rtf: string, cb: ParseCallback) => void;
}

const parseRtf = require("rtf-parser") as RtfParserModule;

function parseRtfToText(rtfString: string): Promise<string> {
  return new Promise((resolve, reject) => {
    parseRtf.string(rtfString, (err, doc) => {
      if (err) {
        reject(err);
        return;
      }

      const paragraphs: string[] = [];
      for (const para of doc.content) {
        if (!Array.isArray(para.content)) continue;
        const spanText = para.content
          .map((span) => (span.value ?? ""))
          .join("");
        paragraphs.push(spanText);
      }

      const text = paragraphs
        .join("\n")
        .split("\n")
        .map((l) => l.trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      resolve(text);
    });
  });
}

/**
 * Fallback: strip RTF markup with a simple regex approach.
 * Used only when the library parser fails (e.g. severely malformed files).
 */
function stripRtfFallback(rtf: string): string {
  let text = rtf;

  text = text.replace(
    /\{\\(pict|object|objdata|objclass|objtime|objw|objh|rsidroot|datastore|datafield|bin\d*)[^}]*\}/gi,
    ""
  );
  text = text.replace(/\{\\\*[^}]*\}/g, "");

  text = text.replace(/\\u(\d+)\??/g, (_, n) => {
    const code = parseInt(n, 10);
    try {
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : "";
    } catch {
      return "";
    }
  });

  text = text.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
    const code = parseInt(hex, 16);
    try {
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

  text = text.replace(/\\(par|pard|line|page|sect|column)\b/g, "\n");
  text = text.replace(/\\tab\b/g, "\t");
  text = text.replace(/\\-/g, "");
  text = text.replace(/\\~/g, "\u00a0");
  text = text.replace(/\\endash\b/g, "\u2013");
  text = text.replace(/\\emdash\b/g, "\u2014");
  text = text.replace(/\\bullet\b/g, "\u2022");
  text = text.replace(/\\[a-zA-Z]+(-?\d+)? ?/g, "");
  text = text.replace(/\\[^a-zA-Z]/g, "");
  text = text.replace(/[{}]/g, "");

  return text
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractRtfContent(buffer: Buffer): Promise<PdfExtraction> {
  const raw = buffer.toString("latin1");

  let text: string;
  try {
    text = await parseRtfToText(raw);
  } catch {
    text = stripRtfFallback(raw);
  }

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
