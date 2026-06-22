import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import iconv from "iconv-lite";
import { extractRtfContent, stripRtfFallback, detectCodepage } from "./rtf-extractor.js";

const fixturesDir = join(import.meta.dirname, "fixtures");

function toBuffer(rtf: string): Buffer {
  return Buffer.from(rtf, "latin1");
}

describe("extractRtfContent — primary parser path", () => {
  describe("simple ASCII RTF", () => {
    it("extracts plain text from a minimal RTF document", async () => {
      const rtf = "{\\rtf1\\ansi Hello World\\par}";
      const result = await extractRtfContent(toBuffer(rtf));
      expect(result.text).toContain("Hello World");
    });

    it("extracts multiple paragraphs", async () => {
      const rtf =
        "{\\rtf1\\ansi First paragraph\\par Second paragraph\\par}";
      const result = await extractRtfContent(toBuffer(rtf));
      expect(result.text).toContain("First paragraph");
      expect(result.text).toContain("Second paragraph");
    });

    it("trims leading and trailing whitespace", async () => {
      const rtf = "{\\rtf1\\ansi   Hello   \\par}";
      const result = await extractRtfContent(toBuffer(rtf));
      expect(result.text).not.toMatch(/^\s/);
      expect(result.text).not.toMatch(/\s$/);
    });

    it("collapses more than two consecutive blank lines", async () => {
      const rtf =
        "{\\rtf1\\ansi Line A\\par\\par\\par\\par Line B\\par}";
      const result = await extractRtfContent(toBuffer(rtf));
      expect(result.text).not.toMatch(/\n{3,}/);
    });

    it("returns the required PdfExtraction shape", async () => {
      const rtf = "{\\rtf1\\ansi Hello\\par}";
      const result = await extractRtfContent(toBuffer(rtf));
      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("pageCount");
      expect(result).toHaveProperty("metadata");
      expect(result).toHaveProperty("images");
      expect(result).toHaveProperty("tables");
      expect(result.pageCount).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(result.images)).toBe(true);
      expect(Array.isArray(result.tables)).toBe(true);
    });

    it("estimates at least one page even for short documents", async () => {
      const rtf = "{\\rtf1\\ansi One line\\par}";
      const result = await extractRtfContent(toBuffer(rtf));
      expect(result.pageCount).toBe(1);
    });
  });

  describe("Unicode / CJK via \\uN escapes", () => {
    it("decodes a Latin supplement character via \\uN", async () => {
      // \u233 = é; the parser decodes the code point AND emits the RTF
      // replacement character ('?') that follows in the RTF source.
      const rtf = "{\\rtf1\\ansi caf\\u233?\\par}";
      const result = await extractRtfContent(toBuffer(rtf));
      expect(result.text).toContain("é");
    });

    it("decodes CJK characters via \\uN escapes", async () => {
      // \u20320 = 你, \u22909 = 好; the trailing '?' is the RTF fallback
      // character that the library also includes in its span output.
      const rtf = "{\\rtf1\\ansi \\u20320?\\u22909?\\par}";
      const result = await extractRtfContent(toBuffer(rtf));
      expect(result.text).toContain("你");
      expect(result.text).toContain("好");
    });

    it("handles a run of consecutive Unicode escapes without crashing", async () => {
      const rtf =
        "{\\rtf1\\ansi \\u1055?\\u1072?\\u1073?\\u1086?\\u1090?\\u1072?\\par}";
      const result = await extractRtfContent(toBuffer(rtf));
      expect(typeof result.text).toBe("string");
      expect(result.pageCount).toBeGreaterThanOrEqual(1);
    });

    it("decodes mixed Japanese and Korean scripts using per-font encodings", async () => {
      // Japanese katakana テスト (Shift_JIS, fcharset128) and Korean 테스트 (EUC-KR, fcharset129).
      // The document-level \ansicpg is 932 (Shift_JIS); the Korean run switches to font 1
      // which maps to EUC-KR via \fcharset129.  Without per-font encoding, the Korean bytes
      // would be decoded as Shift_JIS and produce garbled output.
      const japaneseText = "\u30c6\u30b9\u30c8"; // テスト
      const koreanText = "\ud14c\uc2a4\ud2b8"; // 테스트

      const toRtfHex = (buf: Buffer): string =>
        [...buf].map((b) => `\\'${b.toString(16).padStart(2, "0")}`).join("");

      const jpHex = toRtfHex(iconv.encode(japaneseText, "Shift_JIS") as Buffer);
      const krHex = toRtfHex(iconv.encode(koreanText, "EUC-KR") as Buffer);

      const rtfStr =
        `{\\rtf1\\ansi\\ansicpg932\\deff0\n` +
        `{\\fonttbl\n` +
        `{\\f0\\fnil\\fcharset128 MS Mincho;}\n` +
        `{\\f1\\fnil\\fcharset129 Batang;}\n` +
        `}\n` +
        `\\f0 ${jpHex}\\par\n` +
        `\\f1 ${krHex}\\par\n` +
        `}`;

      // Pass the RTF as a latin1 buffer so raw byte values are preserved (matching
      // how extractRtfContent reads real RTF files off disk).
      const result = await extractRtfContent(Buffer.from(rtfStr, "latin1"));

      expect(result.text).toContain(japaneseText);
      expect(result.text).toContain(koreanText);
    });

    it("decodes \\dbch\\fN and \\loch\\fN run-type font switches in the same paragraph", async () => {
      // \dbch\f1 switches to the DBCS font (GBK Simplified Chinese, fcharset134)
      // for the double-byte run.  \loch\f0 switches back to the Latin font
      // (windows-1252, fcharset0) for the low-half run.
      // Without run-type hint handling the GBK bytes would be decoded as
      // windows-1252 and produce garbled output.
      const chineseText = "\u4e2d\u6587"; // 中文

      const toRtfHex = (buf: Buffer): string =>
        [...buf].map((b) => `\\'${b.toString(16).padStart(2, "0")}`).join("");

      const cnHex = toRtfHex(iconv.encode(chineseText, "GBK") as Buffer);

      const rtfStr =
        `{\\rtf1\\ansi\\ansicpg1252\\deff0\n` +
        `{\\fonttbl\n` +
        `{\\f0\\fswiss\\fcharset0 Arial;}\n` +
        `{\\f1\\fnil\\fcharset134 SimSun;}\n` +
        `}\n` +
        `\\dbch\\f1 ${cnHex}` +
        `\\loch\\f0 Hello\\par\n` +
        `}`;

      const result = await extractRtfContent(Buffer.from(rtfStr, "latin1"));

      expect(result.text).toContain(chineseText);
      expect(result.text).toContain("Hello");
    });
  });

  describe("RTF with nested stylesheet / font groups", () => {
    it("does not include stylesheet control words in the extracted text", async () => {
      const rtf =
        "{\\rtf1\\ansi{\\stylesheet{\\s0 Normal;}{\\s1 Heading 1;}}Content here\\par}";
      const result = await extractRtfContent(toBuffer(rtf));
      expect(result.text).toContain("Content here");
      expect(result.text).not.toMatch(/\\s\d/);
    });

    it("handles deeply nested font/color groups without crashing", async () => {
      const rtf =
        "{\\rtf1\\ansi{\\fonttbl{\\f0\\froman Times New Roman;}}{\\colortbl;\\red0\\green0\\blue0;}Body text\\par}";
      const result = await extractRtfContent(toBuffer(rtf));
      expect(result.text).toContain("Body text");
    });
  });

  describe("malformed RTF input", () => {
    it("returns a string (not an exception) for completely garbage input", async () => {
      const result = await extractRtfContent(toBuffer("NOT RTF AT ALL !@#$%"));
      expect(typeof result.text).toBe("string");
    });

    it("does not throw for an empty buffer", async () => {
      const result = await extractRtfContent(Buffer.alloc(0));
      expect(typeof result.text).toBe("string");
      expect(result.pageCount).toBeGreaterThanOrEqual(1);
    });

    it("always returns the required PdfExtraction shape even for bad input", async () => {
      const result = await extractRtfContent(
        toBuffer("garbage input that will never parse as RTF")
      );
      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("pageCount");
      expect(result).toHaveProperty("metadata");
      expect(result).toHaveProperty("images");
      expect(result).toHaveProperty("tables");
    });
  });

  describe("fixture-based tests", () => {
    it("extracts plain text from a fixture RTF file", async () => {
      const buffer = readFileSync(join(fixturesDir, "sample.rtf"));
      const result = await extractRtfContent(buffer);

      expect(result.text).toBeTruthy();
      expect(result.text.length).toBeGreaterThan(0);
    });

    it("strips RTF control words from the output", async () => {
      const buffer = readFileSync(join(fixturesDir, "sample.rtf"));
      const result = await extractRtfContent(buffer);

      expect(result.text).not.toContain("\\rtf1");
      expect(result.text).not.toContain("\\fonttbl");
      expect(result.text).not.toContain("\\par");
    });

    it("includes readable content words", async () => {
      const buffer = readFileSync(join(fixturesDir, "sample.rtf"));
      const result = await extractRtfContent(buffer);

      expect(result.text).toContain("Course Syllabus");
      expect(result.text).toContain("Grading Policy");
    });

    it("returns at least 1 page", async () => {
      const buffer = readFileSync(join(fixturesDir, "sample.rtf"));
      const result = await extractRtfContent(buffer);

      expect(result.pageCount).toBeGreaterThanOrEqual(1);
    });

    it("returns the correct PdfExtraction shape", async () => {
      const buffer = readFileSync(join(fixturesDir, "sample.rtf"));
      const result = await extractRtfContent(buffer);

      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("pageCount");
      expect(result).toHaveProperty("metadata");
      expect(result).toHaveProperty("images");
      expect(result).toHaveProperty("tables");
      expect(Array.isArray(result.images)).toBe(true);
      expect(Array.isArray(result.tables)).toBe(true);
      expect(result.tables).toEqual([]);
      expect(result.images).toEqual([]);
    });

    it("decodes RTF \\par as newlines to separate paragraphs", async () => {
      const rtf = Buffer.from("{\\rtf1\\ansi First paragraph\\par Second paragraph\\par}");
      const result = await extractRtfContent(rtf);

      expect(result.text).toContain("First paragraph");
      expect(result.text).toContain("Second paragraph");
    });

    it("decodes RTF unicode escapes correctly", async () => {
      const rtf = Buffer.from("{\\rtf1\\ansi \\u8364? Euro symbol\\par}");
      const result = await extractRtfContent(rtf);

      expect(result.text).toContain("\u20ac");
    });

    it("preserves ASCII text adjacent to RTF hex escapes", async () => {
      // rtf-parser handles \'e9 as a Unicode replacement character (U+FFFD);
      // the fallback regex-based path decodes it to é (U+00E9).
      // Either way the surrounding ASCII text must survive.
      const rtf = Buffer.from("{\\rtf1\\ansi caf\\'e9\\par}");
      const result = await extractRtfContent(rtf);

      expect(result.text).toContain("caf");
    });

    it("handles an empty RTF document without throwing", async () => {
      const rtf = Buffer.from("{\\rtf1\\ansi\\deff0 }");
      const result = await extractRtfContent(rtf);

      expect(result.text).toBe("");
      expect(result.pageCount).toBe(1);
    });
  });

  describe("RTF encoding warning (detectCodepage)", () => {
    it("does not warn when \\ansicpg is declared and high bytes are present", async () => {
      const rtf = Buffer.from(
        "{\\rtf1\\ansi\\ansicpg1252\\deff0 caf\\'e9\\par}",
        "latin1"
      );
      const result = await extractRtfContent(rtf);

      expect(result.warnings).toBeUndefined();
    });

    it("warns when no \\ansicpg is declared and high-byte escapes are present", async () => {
      const rtf = Buffer.from("{\\rtf1\\ansi\\deff0 caf\\'e9\\par}", "latin1");
      const result = await extractRtfContent(rtf);

      expect(Array.isArray(result.warnings)).toBe(true);
      expect(result.warnings!.length).toBeGreaterThan(0);
      expect(result.warnings![0]).toMatch(/\\ansicpg/);
      expect(result.warnings![0]).toMatch(/Windows-1252/);
    });

    it("does not warn when no \\ansicpg is declared but the file is pure ASCII", async () => {
      const rtf = Buffer.from(
        "{\\rtf1\\ansi\\deff0 Hello world\\par}",
        "latin1"
      );
      const result = await extractRtfContent(rtf);

      const hasWarning =
        Array.isArray(result.warnings) && result.warnings.length > 0;
      expect(hasWarning).toBe(false);
    });

    it("warning message advises re-saving from Microsoft Word", async () => {
      const rtf = Buffer.from("{\\rtf1\\ansi\\deff0 caf\\'e9\\par}", "latin1");
      const result = await extractRtfContent(rtf);

      expect(result.warnings![0]).toMatch(/Microsoft Word/i);
    });

    it("warns only once even when multiple high-byte sequences appear", async () => {
      const rtf = Buffer.from(
        "{\\rtf1\\ansi\\deff0 \\'e9\\'f0\\'e8\\par}",
        "latin1"
      );
      const result = await extractRtfContent(rtf);

      expect(Array.isArray(result.warnings)).toBe(true);
      expect(result.warnings!.length).toBe(1);
    });

    it("does not warn when \\ansicpg is declared even with high-byte escapes present", async () => {
      const rtf = Buffer.from(
        "{\\rtf1\\ansi\\ansicpg1252\\deff0 some text \\'a9 copyright\\par}",
        "latin1"
      );
      const result = await extractRtfContent(rtf);

      expect(result.warnings).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// detectCodepage — direct unit tests (no rtf-parser overhead)
// ---------------------------------------------------------------------------

describe("detectCodepage — direct unit tests", () => {
  it("detects \\ansicpg codepage and sets hasAnsicpg=true when \\ansicpg is present", () => {
    const result = detectCodepage("{\\rtf1\\ansi\\ansicpg1252\\deff0 caf\\'e9\\par}");
    expect(result.hasAnsicpg).toBe(true);
    expect(result.codepage).toBe(1252);
    expect(result.hasHighBytes).toBe(true);
  });

  it("returns hasAnsicpg=false and codepage=1252 (default) when \\ansicpg is absent but high bytes are present", () => {
    const result = detectCodepage("{\\rtf1\\ansi\\deff0 caf\\'e9\\par}");
    expect(result.hasAnsicpg).toBe(false);
    expect(result.codepage).toBe(1252);
    expect(result.hasHighBytes).toBe(true);
  });

  it("returns hasAnsicpg=false and hasHighBytes=false for pure ASCII input with no \\ansicpg", () => {
    const result = detectCodepage("{\\rtf1\\ansi\\deff0 Hello world\\par}");
    expect(result.hasAnsicpg).toBe(false);
    expect(result.codepage).toBe(1252);
    expect(result.hasHighBytes).toBe(false);
  });

  it("extracts the correct codepage number from \\ansicpg", () => {
    const result = detectCodepage("{\\rtf1\\ansi\\ansicpg932\\deff0 \\par}");
    expect(result.hasAnsicpg).toBe(true);
    expect(result.codepage).toBe(932);
  });

  it("does not detect high bytes when only low-byte \\' escapes are present", () => {
    const result = detectCodepage("{\\rtf1\\ansi\\deff0 \\'41\\'42\\par}");
    expect(result.hasHighBytes).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stripRtfFallback — regex-based path (Windows-1252, pict stripping, etc.)
//
// The rtf-parser library never errors for any string input, so the fallback
// is triggered by callers that detect garbled output and apply it directly.
// These tests guard the fallback logic that handles W-1252 hex escapes,
// picture group stripping, and Unicode \uN sequences.
// ---------------------------------------------------------------------------

describe("stripRtfFallback — regex fallback path", () => {
  describe("Windows-1252 hex escapes (\\'XX)", () => {
    it("decodes \\e9 as é (standard latin-1)", () => {
      expect(stripRtfFallback("{\\rtf1\\ansi caf\\'e9\\par}")).toContain("é");
    });

    it("decodes \\80 as the euro sign (€) via W1252 mapping", () => {
      expect(stripRtfFallback("{\\rtf1\\ansi price\\'80\\par}")).toContain("€");
    });

    it("decodes \\93 and \\94 as left/right double curly quotes", () => {
      const text = stripRtfFallback(
        "{\\rtf1\\ansi \\'93Hello\\'94\\par}"
      );
      expect(text).toContain("\u201c");
      expect(text).toContain("\u201d");
    });

    it("decodes \\96 as an en dash", () => {
      expect(stripRtfFallback("{\\rtf1\\ansi A\\'96B\\par}")).toContain(
        "\u2013"
      );
    });

    it("decodes \\97 as an em dash", () => {
      expect(stripRtfFallback("{\\rtf1\\ansi A\\'97B\\par}")).toContain(
        "\u2014"
      );
    });

    it("decodes \\95 as a bullet", () => {
      expect(stripRtfFallback("{\\rtf1\\ansi \\'95 item\\par}")).toContain(
        "\u2022"
      );
    });
  });

  describe("Unicode \\uN escapes", () => {
    it("decodes \\u233 as é", () => {
      expect(stripRtfFallback("{\\rtf1\\ansi \\u233?\\par}")).toContain("é");
    });

    it("decodes CJK code points via \\uN", () => {
      const text = stripRtfFallback(
        "{\\rtf1\\ansi \\u20320?\\u22909?\\par}"
      );
      expect(text).toContain("你");
      expect(text).toContain("好");
    });

    it("produces a clean result without leftover '?' replacement chars", () => {
      const text = stripRtfFallback("{\\rtf1\\ansi \\u233?\\par}");
      expect(text).not.toContain("?");
    });
  });

  describe("RTF with embedded picture / binary groups", () => {
    it("strips \\pict groups and does not include binary hex data", () => {
      const rtf =
        "{\\rtf1\\ansi Caption text\\par{\\pict\\wmetafile8\\picw1000\\pich1000 DEADBEEF}\\par}";
      const text = stripRtfFallback(rtf);
      expect(text).not.toContain("DEADBEEF");
      expect(text).toContain("Caption text");
    });

    it("strips \\object groups", () => {
      const rtf =
        "{\\rtf1\\ansi Before{\\object\\objemb OBJDATA}After\\par}";
      const text = stripRtfFallback(rtf);
      expect(text).not.toContain("OBJDATA");
    });

    it("strips \\bin binary groups", () => {
      const rtf =
        "{\\rtf1\\ansi Before\\par{\\bin32 BINARYGARBAGE}After\\par}";
      const text = stripRtfFallback(rtf);
      expect(text).not.toContain("BINARYGARBAGE");
    });
  });

  describe("RTF with nested stylesheet groups", () => {
    it("strips the \\stylesheet group via \\{\\*...\\} pattern", () => {
      const rtf =
        "{\\rtf1{\\*\\stylesheet{\\s0 Normal;}{\\s1 Heading;}}Body text\\par}";
      const text = stripRtfFallback(rtf);
      expect(text).toContain("Body text");
      expect(text).not.toMatch(/Normal;/);
    });
  });

  describe("output normalisation", () => {
    it("does not emit more than two consecutive blank lines", () => {
      const rtf =
        "{\\rtf1 A\\par\\par\\par\\par\\par B\\par}";
      expect(stripRtfFallback(rtf)).not.toMatch(/\n{3,}/);
    });

    it("returns an empty string for completely empty input", () => {
      expect(stripRtfFallback("")).toBe("");
    });
  });
});
