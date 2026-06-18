import { describe, it, expect, vi } from "vitest";
import iconv from "iconv-lite";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { extractRtfContent } from "../rtf-extractor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures");

/**
 * Build a minimal but syntactically valid RTF buffer containing CJK text
 * encoded as \'XX byte escapes in the specified codepage.
 *
 * The buffer is returned encoded as latin1 (binary), which is exactly how
 * extractRtfContent reads it internally (buffer.toString("latin1")).
 */
function makeCjkRtf(text: string, codepage: number, encoding: string): Buffer {
  const encoded = iconv.encode(text, encoding);
  const hexEscapes = Array.from(encoded)
    .map((b) => `\\'${b.toString(16).padStart(2, "0")}`)
    .join("");

  const rtf =
    `{\\rtf1\\ansi\\ansicpg${codepage}\\deff0` +
    `{\\fonttbl{\\f0\\fnil CJK Font;}}` +
    `{\\pard ${hexEscapes}\\par}}`;

  return Buffer.from(rtf, "latin1");
}

/**
 * Build a malformed RTF that contains a recognisable \ansicpg control word
 * so the codepage is detected, but whose structure is broken enough that
 * rtf-parser throws and extractRtfContent falls back to stripRtfFallback.
 */
function makeMalformedCjkRtf(
  text: string,
  codepage: number,
  encoding: string
): Buffer {
  const encoded = iconv.encode(text, encoding);
  const hexEscapes = Array.from(encoded)
    .map((b) => `\\'${b.toString(16).padStart(2, "0")}`)
    .join("");

  // Omit the outer braces so rtf-parser cannot parse it as a valid RTF doc.
  const broken =
    `\\rtf1\\ansi\\ansicpg${codepage}` +
    ` ${hexEscapes}` +
    // pile on unclosed groups to ensure the parser rejects it
    `{{{{{{{`;

  return Buffer.from(broken, "latin1");
}

// ---------------------------------------------------------------------------
// Happy-path tests (parser succeeds after CJK pre-processing)
// ---------------------------------------------------------------------------

describe("extractRtfContent — CJK happy path (ansicpg 932 / Shift_JIS)", () => {
  const CODEPAGE = 932;
  const ENCODING = "Shift_JIS";
  const EXPECTED = "日本語";

  it("extracts the Japanese string from the RTF buffer", async () => {
    const buf = makeCjkRtf(EXPECTED, CODEPAGE, ENCODING);
    const result = await extractRtfContent(buf);
    expect(result.text).toContain(EXPECTED);
  });

  it("returns the correct PdfExtraction shape", async () => {
    const buf = makeCjkRtf(EXPECTED, CODEPAGE, ENCODING);
    const result = await extractRtfContent(buf);
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(result.images).toEqual([]);
    expect(result.tables).toEqual([]);
  });

  it("does not include raw RTF control words in the output", async () => {
    const buf = makeCjkRtf(EXPECTED, CODEPAGE, ENCODING);
    const result = await extractRtfContent(buf);
    expect(result.text).not.toContain("\\ansicpg");
    expect(result.text).not.toContain("\\fonttbl");
  });

  it("estimates at least 1 page", async () => {
    const buf = makeCjkRtf(EXPECTED, CODEPAGE, ENCODING);
    const result = await extractRtfContent(buf);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });
});

describe("extractRtfContent — CJK happy path (ansicpg 936 / GBK)", () => {
  const CODEPAGE = 936;
  const ENCODING = "GBK";
  const EXPECTED = "中文";

  it("extracts the Simplified Chinese string from the RTF buffer", async () => {
    const buf = makeCjkRtf(EXPECTED, CODEPAGE, ENCODING);
    const result = await extractRtfContent(buf);
    expect(result.text).toContain(EXPECTED);
  });

  it("returns the correct PdfExtraction shape", async () => {
    const buf = makeCjkRtf(EXPECTED, CODEPAGE, ENCODING);
    const result = await extractRtfContent(buf);
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result.images).toEqual([]);
    expect(result.tables).toEqual([]);
  });
});

describe("extractRtfContent — CJK happy path (ansicpg 949 / EUC-KR)", () => {
  const CODEPAGE = 949;
  const ENCODING = "EUC-KR";
  const EXPECTED = "한국어";

  it("extracts the Korean string from the RTF buffer", async () => {
    const buf = makeCjkRtf(EXPECTED, CODEPAGE, ENCODING);
    const result = await extractRtfContent(buf);
    expect(result.text).toContain(EXPECTED);
  });

  it("returns the correct PdfExtraction shape", async () => {
    const buf = makeCjkRtf(EXPECTED, CODEPAGE, ENCODING);
    const result = await extractRtfContent(buf);
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result.images).toEqual([]);
    expect(result.tables).toEqual([]);
  });
});

describe("extractRtfContent — CJK happy path (ansicpg 950 / Big5)", () => {
  const CODEPAGE = 950;
  const ENCODING = "Big5";
  const EXPECTED = "繁體";

  it("extracts the Traditional Chinese string from the RTF buffer", async () => {
    const buf = makeCjkRtf(EXPECTED, CODEPAGE, ENCODING);
    const result = await extractRtfContent(buf);
    expect(result.text).toContain(EXPECTED);
  });

  it("returns the correct PdfExtraction shape", async () => {
    const buf = makeCjkRtf(EXPECTED, CODEPAGE, ENCODING);
    const result = await extractRtfContent(buf);
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result.images).toEqual([]);
    expect(result.tables).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// stripRtfFallback path (malformed RTF forces the regex-based extractor)
// ---------------------------------------------------------------------------

describe("extractRtfContent — CJK fallback path (stripRtfFallback)", () => {
  it("decodes Shift_JIS bytes via the fallback when the parser fails", async () => {
    const buf = makeMalformedCjkRtf("日本語", 932, "Shift_JIS");
    const result = await extractRtfContent(buf);
    expect(result.text).toContain("日本語");
  });

  it("decodes GBK bytes via the fallback when the parser fails", async () => {
    const buf = makeMalformedCjkRtf("中文", 936, "GBK");
    const result = await extractRtfContent(buf);
    expect(result.text).toContain("中文");
  });

  it("decodes EUC-KR bytes via the fallback when the parser fails", async () => {
    const buf = makeMalformedCjkRtf("한국어", 949, "EUC-KR");
    const result = await extractRtfContent(buf);
    expect(result.text).toContain("한국어");
  });

  it("decodes Big5 bytes via the fallback when the parser fails", async () => {
    const buf = makeMalformedCjkRtf("繁體", 950, "Big5");
    const result = await extractRtfContent(buf);
    expect(result.text).toContain("繁體");
  });

  it("still returns the correct PdfExtraction shape via fallback", async () => {
    const buf = makeMalformedCjkRtf("日本語", 932, "Shift_JIS");
    const result = await extractRtfContent(buf);
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(result.images).toEqual([]);
    expect(result.tables).toEqual([]);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Mixed content: ASCII + CJK in the same paragraph
// ---------------------------------------------------------------------------

describe("extractRtfContent — ASCII + CJK mixed content", () => {
  it("preserves ASCII text alongside Shift_JIS characters (codepage 932)", async () => {
    const cjkPart = "日本語";
    const encoded = iconv.encode(cjkPart, "Shift_JIS");
    const hexEscapes = Array.from(encoded)
      .map((b) => `\\'${b.toString(16).padStart(2, "0")}`)
      .join("");
    const rtf =
      `{\\rtf1\\ansi\\ansicpg932\\deff0` +
      `{\\fonttbl{\\f0\\fnil Arial;}}` +
      `{\\pard Hello ${hexEscapes} World\\par}}`;
    const buf = Buffer.from(rtf, "latin1");
    const result = await extractRtfContent(buf);
    expect(result.text).toContain("Hello");
    expect(result.text).toContain("World");
    expect(result.text).toContain(cjkPart);
  });

  it("preserves ASCII text alongside GBK characters (codepage 936)", async () => {
    const cjkPart = "中文";
    const encoded = iconv.encode(cjkPart, "GBK");
    const hexEscapes = Array.from(encoded)
      .map((b) => `\\'${b.toString(16).padStart(2, "0")}`)
      .join("");
    const rtf =
      `{\\rtf1\\ansi\\ansicpg936\\deff0` +
      `{\\fonttbl{\\f0\\fnil Arial;}}` +
      `{\\pard Prefix ${hexEscapes} Suffix\\par}}`;
    const buf = Buffer.from(rtf, "latin1");
    const result = await extractRtfContent(buf);
    expect(result.text).toContain("Prefix");
    expect(result.text).toContain("Suffix");
    expect(result.text).toContain(cjkPart);
  });
});

// ---------------------------------------------------------------------------
// Unicode escape (\uN) with CJK codepage — fallback bytes must be stripped
// ---------------------------------------------------------------------------

describe("extractRtfContent — \\uN escapes with CJK codepage", () => {
  it("correctly resolves \\uN escapes in a Shift_JIS document (codepage 932)", async () => {
    // \u26085 is U+65E5 (日). RTF appends a \'XX fallback byte after \uN;
    // the pre-processor must strip that fallback byte so rtf-parser gets a
    // clean Unicode escape.
    const rtf =
      `{\\rtf1\\ansi\\ansicpg932\\deff0` +
      `{\\fonttbl{\\f0\\fnil Arial;}}` +
      `{\\pard \\u26085\\'3f\\par}}`;
    const buf = Buffer.from(rtf, "latin1");
    const result = await extractRtfContent(buf);
    expect(result.text).toContain("\u65E5");
  });
});

// ---------------------------------------------------------------------------
// Fixture-based round-trip tests (ground-truth binary RTF files)
//
// These tests read pre-built binary RTF fixture files from disk and assert
// that the known Unicode content survives the full decode pipeline.  Because
// the fixture bytes were frozen at generation time, any regression introduced
// by an iconv-lite or rtf-parser version bump will cause these tests to fail
// even if the synthetic makeCjkRtf() tests still pass (since those encode
// with the new library too and would mask the drift).
//
// Fixture files live in server/lib/fixtures/ and can be regenerated with:
//   node server/lib/fixtures/generate-cjk-rtf.mjs
// ---------------------------------------------------------------------------

describe("extractRtfContent — fixture round-trip (ansicpg 932 / Shift_JIS)", () => {
  const FIXTURE = "cjk-932-shift-jis.rtf";
  const EXPECTED_CHARS = ["日", "本", "語", "テ", "ス"];

  it("extracts known Japanese characters from the binary fixture", async () => {
    const buf = readFileSync(join(FIXTURES_DIR, FIXTURE));
    const result = await extractRtfContent(buf);
    for (const ch of EXPECTED_CHARS) {
      expect(result.text).toContain(ch);
    }
  });

  it("returns the correct PdfExtraction shape from the fixture", async () => {
    const buf = readFileSync(join(FIXTURES_DIR, FIXTURE));
    const result = await extractRtfContent(buf);
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(result.images).toEqual([]);
    expect(result.tables).toEqual([]);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });

  it("does not include raw RTF control words in the fixture output", async () => {
    const buf = readFileSync(join(FIXTURES_DIR, FIXTURE));
    const result = await extractRtfContent(buf);
    expect(result.text).not.toContain("\\ansicpg");
    expect(result.text).not.toContain("\\fonttbl");
  });
});

describe("extractRtfContent — fixture round-trip (ansicpg 936 / GBK)", () => {
  const FIXTURE = "cjk-936-gbk.rtf";
  const EXPECTED_CHARS = ["中", "文", "测", "试"];

  it("extracts known Simplified Chinese characters from the binary fixture", async () => {
    const buf = readFileSync(join(FIXTURES_DIR, FIXTURE));
    const result = await extractRtfContent(buf);
    for (const ch of EXPECTED_CHARS) {
      expect(result.text).toContain(ch);
    }
  });

  it("returns the correct PdfExtraction shape from the fixture", async () => {
    const buf = readFileSync(join(FIXTURES_DIR, FIXTURE));
    const result = await extractRtfContent(buf);
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(result.images).toEqual([]);
    expect(result.tables).toEqual([]);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });
});

describe("extractRtfContent — fixture round-trip (ansicpg 949 / EUC-KR)", () => {
  const FIXTURE = "cjk-949-euc-kr.rtf";
  const EXPECTED_CHARS = ["한", "국", "어", "테"];

  it("extracts known Korean characters from the binary fixture", async () => {
    const buf = readFileSync(join(FIXTURES_DIR, FIXTURE));
    const result = await extractRtfContent(buf);
    for (const ch of EXPECTED_CHARS) {
      expect(result.text).toContain(ch);
    }
  });

  it("returns the correct PdfExtraction shape from the fixture", async () => {
    const buf = readFileSync(join(FIXTURES_DIR, FIXTURE));
    const result = await extractRtfContent(buf);
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(result.images).toEqual([]);
    expect(result.tables).toEqual([]);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });
});

describe("extractRtfContent — fixture round-trip (ansicpg 950 / Big5)", () => {
  const FIXTURE = "cjk-950-big5.rtf";
  const EXPECTED_CHARS = ["繁", "體", "中", "文"];

  it("extracts known Traditional Chinese characters from the binary fixture", async () => {
    const buf = readFileSync(join(FIXTURES_DIR, FIXTURE));
    const result = await extractRtfContent(buf);
    for (const ch of EXPECTED_CHARS) {
      expect(result.text).toContain(ch);
    }
  });

  it("returns the correct PdfExtraction shape from the fixture", async () => {
    const buf = readFileSync(join(FIXTURES_DIR, FIXTURE));
    const result = await extractRtfContent(buf);
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(result.images).toEqual([]);
    expect(result.tables).toEqual([]);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });
});
