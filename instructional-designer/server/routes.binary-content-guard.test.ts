import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// This is a static-analysis regression test, not a runtime test. Task #1101
// added binary-content sniffing (magic bytes + control-byte ratio) to the
// /api/upload-syllabus .txt branch so a PDF/DOC/DOCX renamed to .txt (or
// mislabeled with a text/plain MIME) can't be silently decoded and stored as
// plain text. Task #1114 audited routes.ts for any *other* place that reads
// an uploaded/inbound buffer as UTF-8 text based on client-supplied
// extension/MIME alone, and found none besides /api/upload-syllabus.
//
// Rather than leave that as a one-time audit note, this test scans the
// source for `.buffer.toString("utf-8")` (or "utf8") call sites and fails if
// a *new* one is introduced without a nearby looksLikeBinaryContent(...)
// guard. This is intentionally a source-text check (not an import + call)
// so it also catches guards that exist but were moved out of range, and so
// it never needs real file buffers or a running server.
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const routesSource = fs.readFileSync(path.join(__dirname, "routes.ts"), "utf-8");

const UTF8_DECODE_PATTERN = /\.buffer\.toString\(\s*["'](utf-?8)["']\s*\)/gi;

function findLineNumber(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

describe("binary-content sniffing coverage (source audit)", () => {
  it("guards every buffer-to-UTF-8-text decode with a binary-content check nearby", () => {
    const decodeSites: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = UTF8_DECODE_PATTERN.exec(routesSource)) !== null) {
      decodeSites.push(match.index);
    }

    expect(decodeSites.length).toBeGreaterThan(0);

    const CONTEXT_WINDOW = 400; // chars of source to look back for a guard
    const unguarded = decodeSites.filter((index) => {
      const windowStart = Math.max(0, index - CONTEXT_WINDOW);
      const preceding = routesSource.slice(windowStart, index);
      return !preceding.includes("looksLikeBinaryContent(");
    });

    if (unguarded.length > 0) {
      const lines = unguarded.map((index) => findLineNumber(routesSource, index));
      throw new Error(
        `Found ${unguarded.length} buffer-to-UTF-8-text decode(s) in routes.ts without a ` +
          `preceding looksLikeBinaryContent(...) guard (line(s): ${lines.join(", ")}). ` +
          `Any endpoint that trusts a client-supplied extension/MIME to read an uploaded ` +
          `buffer as text must call looksLikeBinaryContent() first, or a renamed PDF/DOC/DOCX ` +
          `can be silently ingested as plain text (see task #1101 / #1114).`,
      );
    }
  });

  it("still has exactly one known ingestion path today (/api/upload-syllabus)", () => {
    // This is a soft tripwire, not a hard limit: if this count changes, it
    // means a new text-ingestion path was added. That's fine as long as the
    // test above confirms it's guarded — this second assertion just makes
    // the audit's scope visible in the test output instead of silent.
    const decodeCount = (routesSource.match(UTF8_DECODE_PATTERN) || []).length;
    expect(decodeCount).toBe(1);
  });
});
