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

/**
 * RTF \fcharset values mapped to Windows codepage numbers.
 * The \fcharset control word appears inside \fonttbl entries to specify the
 * character set for that font.  We use it to determine which encoding to apply
 * when decoding \'XX byte sequences that belong to runs using that font.
 */
const FCHARSET_TO_CODEPAGE: Record<number, number> = {
  0: 1252,
  128: 932,
  129: 949,
  130: 1361,
  134: 936,
  136: 950,
  161: 1253,
  162: 1254,
  163: 1258,
  177: 1255,
  178: 1256,
  186: 1257,
  204: 1251,
  222: 874,
  238: 1250,
  255: 1252,
};

/** Set of iconv-lite encoding names that correspond to DBCS codepages. */
const CJK_ENCODINGS = new Set(
  [...DBCS_CODEPAGES].map((cp) => CODEPAGE_TO_ENCODING[cp]).filter(Boolean)
);

interface CodepageDetection {
  codepage: number;
  hasAnsicpg: boolean;
  hasHighBytes: boolean;
}

function detectCodepage(rtf: string): CodepageDetection {
  const m = rtf.match(/\\ansicpg(\d+)/);
  const hasAnsicpg = m !== null;
  const codepage = hasAnsicpg ? parseInt(m![1], 10) : 1252;
  // Check for \'XX escapes with byte values > 0x7F (non-ASCII content)
  const hasHighBytes = /\\'([89a-fA-F][0-9a-fA-F])/i.test(rtf);
  return { codepage, hasAnsicpg, hasHighBytes };
}

/**
 * Parse the RTF font table to build a map from font number → iconv-lite
 * encoding name.  Each \fonttbl entry looks like:
 *
 *   {\f0\froman\fcharset0 Times New Roman;}
 *   {\f2\fnil\fcharset128 MS Mincho;}
 *   {\f3\fnil\fcharset129 Batang;}
 *
 * We extract every \fN ... \fcharsetM pairing within the same brace group.
 */
function buildFontEncodingMap(rtf: string): Map<number, string> {
  const map = new Map<number, string>();
  // Match \fN followed by optional RTF keywords, then \fcharsetM — all within
  // the same font entry (no braces or semicolons in between).
  const re = /\\f(\d+)\b[^{};]*?\\fcharset(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rtf)) !== null) {
    const fontNum = parseInt(m[1], 10);
    const charsetNum = parseInt(m[2], 10);
    const cp = FCHARSET_TO_CODEPAGE[charsetNum];
    if (cp !== undefined) {
      const enc = CODEPAGE_TO_ENCODING[cp];
      if (enc !== undefined) {
        map.set(fontNum, enc);
      }
    }
  }
  return map;
}

/**
 * Pre-process RTF source to decode \'XX byte escapes, applying the correct
 * iconv-lite encoding for each run of escapes based on the active font at that
 * point in the document.
 *
 * RTF uses \'XX to encode one byte in the current codepage.  For DBCS
 * codepages (CJK), two or more consecutive \'XX sequences encode a single
 * character.  When a document mixes scripts (e.g. Japanese body text + Korean
 * footnote), the font table maps each font number to a charset, and \fN
 * control words in the body switch the active font — and therefore the active
 * encoding — mid-document.
 *
 * Algorithm:
 *   1. Strip \'XX fallback bytes that immediately follow \uN escapes (they are
 *      redundant; the \uN value is the authoritative Unicode codepoint).
 *   2. Scan the RTF character-by-character.  When a \fN control word is seen,
 *      switch the active encoding to fontEncodings.get(N) (fallback: default).
 *   3. Collect consecutive \'XX escape runs; decode each run using the active
 *      encoding at the start of the run and splice the decoded text back in.
 */
function decodeCjkByteSequences(
  rtf: string,
  defaultEncoding: string,
  fontEncodings: Map<number, string>
): string {
  // Step 1: Remove the \'XX fallback byte that RTF appends after \uN escapes.
  let text = rtf.replace(
    /\\u(-?\d+)\\?'[0-9a-fA-F]{2}/g,
    (_, n) => `\\u${n} `
  );

  // Step 2: Scan through the RTF, tracking active font/encoding.
  let result = "";
  let i = 0;
  let currentEncoding = defaultEncoding;

  while (i < text.length) {
    const ch = text[i];

    if (ch !== "\\") {
      result += ch;
      i++;
      continue;
    }

    // We have a backslash.
    if (i + 1 >= text.length) {
      result += ch;
      i++;
      continue;
    }

    const next = text[i + 1];

    // Hex escape: \'XX  — collect a consecutive run, decode together.
    if (next === "'") {
      const bytes: number[] = [];
      const runStart = i;
      while (
        i < text.length &&
        text[i] === "\\" &&
        i + 1 < text.length &&
        text[i + 1] === "'" &&
        i + 3 < text.length
      ) {
        const hex = text.substring(i + 2, i + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          bytes.push(parseInt(hex, 16));
          i += 4;
        } else {
          break;
        }
      }
      if (bytes.length > 0) {
        try {
          result += iconv.decode(Buffer.from(bytes), currentEncoding);
        } catch {
          result += text.substring(runStart, i);
        }
      }
      continue;
    }

    // Alpha control word: \<letters><optional digits><optional space>
    if (/[a-zA-Z]/.test(next)) {
      let j = i + 1;
      while (j < text.length && /[a-zA-Z]/.test(text[j])) j++;
      const word = text.substring(i + 1, j);

      // Parse optional signed numeric parameter.
      let numStr = "";
      const numStart = j;
      if (j < text.length && (text[j] === "-" || /\d/.test(text[j]))) {
        let k = numStart;
        if (text[k] === "-") k++;
        while (k < text.length && /\d/.test(text[k])) k++;
        numStr = text.substring(numStart, k);
        j = k;
      }

      // Skip trailing space delimiter (part of the control word token).
      if (j < text.length && text[j] === " ") j++;

      // \fN (word === 'f', numStr is digits) — font switch.
      if (word === "f" && numStr !== "") {
        const fontNum = parseInt(numStr, 10);
        const enc = fontEncodings.get(fontNum);
        currentEncoding = enc !== undefined ? enc : defaultEncoding;
      }

      result += text.substring(i, j);
      i = j;
      continue;
    }

    // Other backslash sequences: \* \{ \} \\ \- \~ etc.
    result += ch;
    result += next;
    i += 2;
  }

  return result;
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
 * Exported for unit testing.
 */
export function stripRtfFallback(rtf: string, encoding = "windows-1252"): string {
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

  const { codepage, hasAnsicpg, hasHighBytes } = detectCodepage(raw);
  const defaultEncoding = CODEPAGE_TO_ENCODING[codepage] ?? "windows-1252";

  // Build warnings list. If the file contains non-ASCII byte escapes but
  // declares no \ansicpg codepage, the decoded text may be garbled.
  const warnings: string[] = [];
  if (!hasAnsicpg && hasHighBytes) {
    warnings.push(
      "This RTF file does not declare an \\ansicpg codepage. " +
        "Characters outside basic ASCII have been decoded using the Windows-1252 " +
        "default, which may produce garbled text for non-Western content. " +
        "To fix this, re-save the document from Microsoft Word and ensure the " +
        "correct language and codepage are set before exporting to RTF."
    );
  }

  // Build per-font encoding map from the \fonttbl in the RTF header.
  const fontEncodings = buildFontEncodingMap(raw);

  // Pre-process if the document-level codepage or any font uses a DBCS
  // (CJK) encoding — either condition means \'XX byte sequences may encode
  // multi-byte characters that require iconv-lite to decode correctly.
  const hasCjkFont = [...fontEncodings.values()].some((enc) =>
    CJK_ENCODINGS.has(enc)
  );
  const needsDecoding = DBCS_CODEPAGES.has(codepage) || hasCjkFont;

  const rtfSource = needsDecoding
    ? decodeCjkByteSequences(raw, defaultEncoding, fontEncodings)
    : raw;

  let text: string;
  try {
    text = await parseRtfToText(rtfSource);
  } catch {
    text = stripRtfFallback(raw, defaultEncoding);
  }

  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const estimatedPages = Math.max(1, Math.ceil(lines.length / 40));

  return {
    text,
    pageCount: estimatedPages,
    metadata: {},
    images: [],
    tables: [],
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
