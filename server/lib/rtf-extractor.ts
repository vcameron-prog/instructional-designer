import { createRequire } from "module";
import iconv from "iconv-lite";
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

/**
 * Codepage numbers found in RTF \ansicpg control words mapped to iconv-lite
 * encoding names.
 *
 * Supported CJK codepages:
 *   932  – Shift_JIS (Japanese)
 *   936  – GBK / GB2312 (Simplified Chinese)
 *   949  – EUC-KR (Korean)
 *   950  – Big5 (Traditional Chinese)
 *
 * Limitations:
 *   - RTF files that omit \ansicpg and rely solely on \dbch / \fcharset font
 *     switching to signal the codepage cannot be auto-detected; those files fall
 *     back to Windows-1252 decoding and may still show garbled characters.
 *   - Mixed-codepage RTF (e.g. Japanese body + Korean footnote) is not handled;
 *     the document-level \ansicpg wins for all \'XX byte sequences.
 */
const CODEPAGE_TO_ENCODING: Record<number, string> = {
  932: "Shift_JIS",
  936: "GBK",
  949: "EUC-KR",
  950: "Big5",
  1250: "windows-1250",
  1251: "windows-1251",
  1252: "windows-1252",
  1253: "windows-1253",
  1254: "windows-1254",
  1255: "windows-1255",
  1256: "windows-1256",
  1257: "windows-1257",
  1258: "windows-1258",
};

/** Codepages that use double-byte (or multi-byte) character sequences. */
const DBCS_CODEPAGES = new Set([932, 936, 949, 950]);

function detectCodepage(rtf: string): number {
  const m = rtf.match(/\\ansicpg(\d+)/);
  return m ? parseInt(m[1], 10) : 1252;
}

/**
 * Pre-process RTF source to decode \'XX byte escapes using the given iconv-lite
 * encoding before handing the text to rtf-parser.
 *
 * RTF uses \'XX to encode one byte in the current codepage. For DBCS codepages
 * (CJK), two or more consecutive \'XX sequences may encode a single character.
 * rtf-parser handles \uN Unicode escapes correctly but may not decode DBCS byte
 * runs properly. We therefore:
 *   1. Strip \'XX fallback bytes that immediately follow \uN escapes (they are
 *      redundant; the \uN value is the authoritative Unicode codepoint).
 *   2. Collect every remaining run of consecutive \'XX escapes, decode the raw
 *      bytes with iconv-lite using the detected encoding, and splice the decoded
 *      Unicode text back in place of the escape run.
 */
function decodeCjkByteSequences(rtf: string, encoding: string): string {
  // Step 1: Remove the \'XX fallback byte that RTF appends after \uN escapes.
  // Pattern: \uN followed immediately by \'XX (the byte is just a 1-char fallback).
  let processed = rtf.replace(
    /\\u(-?\d+)\\?'[0-9a-fA-F]{2}/g,
    (_, n) => `\\u${n} `
  );

  // Step 2: Replace each run of \'XX escapes with iconv-decoded Unicode text.
  processed = processed.replace(/((?:\\'[0-9a-fA-F]{2})+)/g, (run) => {
    const bytes: number[] = [];
    const hexRe = /\\'([0-9a-fA-F]{2})/g;
    let m: RegExpExecArray | null;
    while ((m = hexRe.exec(run)) !== null) {
      bytes.push(parseInt(m[1], 16));
    }
    try {
      return iconv.decode(Buffer.from(bytes), encoding);
    } catch {
      return run;
    }
  });

  return processed;
}

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
function stripRtfFallback(rtf: string, encoding: string): string {
  let text = rtf;

  text = text.replace(
    /\{\\(pict|object|objdata|objclass|objtime|objw|objh|rsidroot|datastore|datafield|bin\d*)[^}]*\}/gi,
    ""
  );
  text = text.replace(/\{\\\*[^}]*\}/g, "");

  // Decode \uN Unicode escapes first.
  text = text.replace(/\\u(\d+)\??/g, (_, n) => {
    const code = parseInt(n, 10);
    try {
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : "";
    } catch {
      return "";
    }
  });

  // Decode \'XX byte sequences using the detected encoding (handles CJK DBCS).
  text = text.replace(/((?:\\'[0-9a-fA-F]{2})+)/g, (run) => {
    const bytes: number[] = [];
    const hexRe = /\\'([0-9a-fA-F]{2})/g;
    let m: RegExpExecArray | null;
    while ((m = hexRe.exec(run)) !== null) {
      bytes.push(parseInt(m[1], 16));
    }
    try {
      return iconv.decode(Buffer.from(bytes), encoding);
    } catch {
      // Windows-1252 fallback for single-byte sequences.
      return bytes
        .map((code) => {
          const W1252: Record<number, number> = {
            0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e,
            0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
            0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
            0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
            0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
            0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
            0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
          };
          try {
            return String.fromCodePoint(W1252[code] ?? code);
          } catch {
            return "";
          }
        })
        .join("");
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
  // Read as latin1 to preserve raw byte values in \'XX sequences.
  const raw = buffer.toString("latin1");

  const codepage = detectCodepage(raw);
  const encoding = CODEPAGE_TO_ENCODING[codepage] ?? "windows-1252";

  // For DBCS (CJK) codepages, pre-process the RTF source so that rtf-parser
  // receives decoded Unicode text instead of raw DBCS byte escapes it may not
  // handle correctly.  For single-byte Western codepages rtf-parser already
  // does a good job, so we skip the pre-processing step.
  const rtfSource =
    DBCS_CODEPAGES.has(codepage)
      ? decodeCjkByteSequences(raw, encoding)
      : raw;

  let text: string;
  try {
    text = await parseRtfToText(rtfSource);
  } catch {
    text = stripRtfFallback(raw, encoding);
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
