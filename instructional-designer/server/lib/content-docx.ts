import {
  Document,
  Paragraph,
  Table,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Packer,
} from "docx";
import { parse, HTMLElement as HtmlElement } from "node-html-parser";
import { processTable } from "./docx-builder.js";

export interface ContentDocxItem {
  toolName: string;
  content: string;
  createdAt: Date | string;
}

export interface ContentDocxCourse {
  courseName: string;
  courseNumber: string;
  sectionNumber?: string | null;
  instructor: string;
  semester: string;
}

export interface InlineRun {
  text: string;
  bold?: true;
  italics?: true;
}

export function parseMarkdownInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];

  const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*|__([^_]+)__|_([^_]+)_)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ text: text.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      runs.push({ text: match[2], bold: true });
    } else if (match[3]) {
      runs.push({ text: match[3], italics: true });
    } else if (match[4]) {
      runs.push({ text: match[4], bold: true });
    } else if (match[5]) {
      runs.push({ text: match[5], italics: true });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    runs.push({ text: text.slice(lastIndex) });
  }

  if (runs.length === 0) {
    runs.push({ text });
  }

  return runs;
}

function parseInlineFormatting(text: string): TextRun[] {
  return parseMarkdownInline(text).map(
    (r) => new TextRun({ ...r, size: 22 }),
  );
}

const TABLE_BLOCK_RE = /(<table[\s\S]*?<\/table>)/gi;

function processMarkdownLines(
  text: string,
  out: (Paragraph | Table)[],
): void {
  const lines = text.split("\n");

  for (const line of lines) {
    if (!line.trim()) {
      out.push(new Paragraph({ children: [] }));
      continue;
    }

    if (line.startsWith("# ")) {
      out.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line.replace(/^# /, ""),
              bold: true,
              size: 32,
              color: "7C1D32",
            }),
          ],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
        }),
      );
    } else if (line.startsWith("## ")) {
      out.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line.replace(/^## /, ""),
              bold: true,
              size: 28,
              color: "333333",
            }),
          ],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 150 },
        }),
      );
    } else if (line.startsWith("### ")) {
      out.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line.replace(/^### /, ""),
              bold: true,
              size: 24,
            }),
          ],
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
        }),
      );
    } else if (line.startsWith("**") && line.endsWith("**")) {
      out.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line.replace(/\*\*/g, ""),
              bold: true,
              size: 24,
            }),
          ],
          spacing: { before: 200, after: 80 },
        }),
      );
    } else if (line.match(/^[-*] /)) {
      const textRuns = parseInlineFormatting(line.replace(/^[-*] /, ""));
      out.push(
        new Paragraph({
          children: textRuns,
          bullet: { level: 0 },
          spacing: { after: 80 },
        }),
      );
    } else if (line.match(/^\d+\. /)) {
      const textRuns = parseInlineFormatting(line.replace(/^\d+\. /, ""));
      out.push(
        new Paragraph({
          children: textRuns,
          numbering: { reference: "content-numbering", level: 0 },
          spacing: { after: 80 },
        }),
      );
    } else if (line.startsWith("   - ") || line.startsWith("   * ")) {
      const textRuns = parseInlineFormatting(line.replace(/^   [-*] /, ""));
      out.push(
        new Paragraph({
          children: textRuns,
          bullet: { level: 1 },
          spacing: { after: 60 },
        }),
      );
    } else {
      const textRuns = parseInlineFormatting(line);
      out.push(
        new Paragraph({
          children: textRuns,
          spacing: { after: 120 },
        }),
      );
    }
  }
}

export async function buildContentDocx(
  item: ContentDocxItem,
  course: ContentDocxCourse | null,
): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: item.toolName,
          bold: true,
          size: 36,
          color: "7C1D32",
        }),
      ],
      heading: HeadingLevel.TITLE,
      spacing: { after: 200 },
    }),
  );

  if (course) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${course.courseName} (${course.courseNumber}${course.sectionNumber ? `, Section ${course.sectionNumber}` : ""})`,
            size: 24,
            color: "666666",
          }),
        ],
        spacing: { after: 100 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Instructor: ${course.instructor} | Semester: ${course.semester}`,
            size: 20,
            color: "666666",
          }),
        ],
        spacing: { after: 400 },
      }),
    );
  }

  children.push(
    new Paragraph({
      children: [],
      border: {
        bottom: { color: "CCCCCC", style: BorderStyle.SINGLE, size: 6 },
      },
      spacing: { after: 400 },
    }),
  );

  const segments = item.content.split(TABLE_BLOCK_RE);

  for (const segment of segments) {
    if (/^<table/i.test(segment.trimStart())) {
      const root = parse(segment);
      const tableEl = root.querySelector("table") as HtmlElement | null;
      if (tableEl) {
        const table = processTable(tableEl);
        if (table) children.push(table);
      }
    } else {
      processMarkdownLines(segment, children);
    }
  }

  const createdAt =
    item.createdAt instanceof Date
      ? item.createdAt
      : new Date(item.createdAt);

  children.push(
    new Paragraph({ children: [], spacing: { before: 600 } }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Generated by BSU Accessibility Tool",
          size: 18,
          color: "999999",
          italics: true,
        }),
      ],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Created on ${createdAt.toLocaleDateString()}`,
          size: 18,
          color: "999999",
          italics: true,
        }),
      ],
      alignment: AlignmentType.CENTER,
    }),
  );

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "content-numbering",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
