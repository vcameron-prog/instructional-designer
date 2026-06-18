/**
 * One-time generator for CJK RTF fixture files.
 *
 * These fixtures are committed as binary files and used by
 * rtf-extractor.cjk.test.ts to verify the full decode round-trip
 * independently of iconv-lite's encode() path in the test itself.
 *
 * RTF \fcharset values that map to CJK codepages (from FCHARSET_TO_CODEPAGE
 * in rtf-extractor.ts):
 *   128 → 932  (Shift_JIS / Japanese)
 *   134 → 936  (GBK / Simplified Chinese)
 *   129 → 949  (EUC-KR / Korean)
 *   136 → 950  (Big5 / Traditional Chinese)
 *
 * Using the correct \fcharset ensures that when the extractor sees the \f0
 * control word in the body, it switches to the right CJK encoding rather than
 * defaulting to windows-1252.
 *
 * Run with:  node server/lib/fixtures/generate-cjk-rtf.mjs
 */
import iconv from "iconv-lite";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURES = [
  {
    codepage: 932,
    fcharset: 128,
    encoding: "Shift_JIS",
    fontName: "MS Mincho",
    text: "日本語テスト内容",
    filename: "cjk-932-shift-jis.rtf",
  },
  {
    codepage: 936,
    fcharset: 134,
    encoding: "GBK",
    fontName: "SimSun",
    text: "中文测试内容简体",
    filename: "cjk-936-gbk.rtf",
  },
  {
    codepage: 949,
    fcharset: 129,
    encoding: "EUC-KR",
    fontName: "Batang",
    text: "한국어테스트내용",
    filename: "cjk-949-euc-kr.rtf",
  },
  {
    codepage: 950,
    fcharset: 136,
    encoding: "Big5",
    fontName: "MingLiU",
    text: "繁體中文測試內容",
    filename: "cjk-950-big5.rtf",
  },
];

for (const { codepage, fcharset, encoding, fontName, text, filename } of FIXTURES) {
  const encoded = iconv.encode(text, encoding);
  const hexEscapes = Array.from(encoded)
    .map((b) => `\\'${b.toString(16).padStart(2, "0")}`)
    .join("");

  const rtf =
    `{\\rtf1\\ansi\\ansicpg${codepage}\\deff0\r\n` +
    `{\\fonttbl{\\f0\\fnil\\fcharset${fcharset} ${fontName};}}\r\n` +
    `\\viewkind4\\uc1\\pard\\f0\\fs24 ` +
    hexEscapes +
    `\\par\r\n}\r\n`;

  const outPath = join(__dirname, filename);
  writeFileSync(outPath, Buffer.from(rtf, "latin1"));
  console.log(`wrote ${filename}  (${Buffer.from(rtf, "latin1").length} bytes)`);
}
