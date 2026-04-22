import { describe, it, expect } from "vitest";
import { convertMarkdownTablesToHtml } from "./markdownTableConverter.js";

describe("convertMarkdownTablesToHtml", () => {
  it("converts a basic single-column pipe table", () => {
    const input = "| Name |\n| --- |\n| Alice |\n| Bob |";
    const output = convertMarkdownTablesToHtml(input);
    expect(output).toContain("<table>");
    expect(output).toContain('<th scope="col">Name</th>');
    expect(output).toContain("<td>Alice</td>");
    expect(output).toContain("<td>Bob</td>");
    expect(output).toContain("</table>");
  });

  it("converts a multi-column pipe table", () => {
    const input = "| Name | Age | Role |\n| --- | --- | --- |\n| Alice | 30 | Admin |\n| Bob | 25 | User |";
    const output = convertMarkdownTablesToHtml(input);
    expect(output).toContain('<th scope="col">Name</th>');
    expect(output).toContain('<th scope="col">Age</th>');
    expect(output).toContain('<th scope="col">Role</th>');
    expect(output).toContain("<td>Alice</td><td>30</td><td>Admin</td>");
    expect(output).toContain("<td>Bob</td><td>25</td><td>User</td>");
  });

  it("uses the nearest preceding markdown heading as caption", () => {
    const input = "## User List\n\n| Name | Email |\n| --- | --- |\n| Alice | alice@example.com |";
    const output = convertMarkdownTablesToHtml(input);
    expect(output).toContain("<caption>User List</caption>");
  });

  it("falls back to 'Data table' when no heading precedes the table", () => {
    const input = "| Col A | Col B |\n| --- | --- |\n| 1 | 2 |";
    const output = convertMarkdownTablesToHtml(input);
    expect(output).toContain("<caption>Data table</caption>");
  });

  it("converts multiple tables in one document, each with its own caption", () => {
    const input = [
      "## First Section",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "## Second Section",
      "",
      "| X | Y |",
      "| --- | --- |",
      "| 3 | 4 |",
    ].join("\n");
    const output = convertMarkdownTablesToHtml(input);
    expect(output).toContain("<caption>First Section</caption>");
    expect(output).toContain("<caption>Second Section</caption>");
    const tableCount = (output.match(/<table>/g) || []).length;
    expect(tableCount).toBe(2);
  });

  it("handles separator rows with alignment colons", () => {
    const input = "| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |";
    const output = convertMarkdownTablesToHtml(input);
    expect(output).toContain('<th scope="col">Left</th>');
    expect(output).toContain('<th scope="col">Center</th>');
    expect(output).toContain('<th scope="col">Right</th>');
    expect(output).toContain("<td>a</td><td>b</td><td>c</td>");
  });

  it("does not convert table-like text inside a fenced code block", () => {
    const input = "```\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```";
    const output = convertMarkdownTablesToHtml(input);
    expect(output).not.toContain("<table>");
    expect(output).toContain("| A | B |");
  });

  it("preserves surrounding non-table content", () => {
    const input = "Some intro text.\n\n| Name |\n| --- |\n| Alice |\n\nSome trailing text.";
    const output = convertMarkdownTablesToHtml(input);
    expect(output).toContain("Some intro text.");
    expect(output).toContain("<table>");
    expect(output).toContain("Some trailing text.");
  });

  it("converts a table at the very start of the document (no heading above it)", () => {
    const input = "| ID | Value |\n| --- | --- |\n| 1 | foo |";
    const output = convertMarkdownTablesToHtml(input);
    expect(output).toContain("<caption>Data table</caption>");
    expect(output).toContain('<th scope="col">ID</th>');
    expect(output).toContain("<td>1</td><td>foo</td>");
  });

  it("strips markdown formatting from heading when building the caption", () => {
    const input = "## **Bold Heading**\n\n| Col |\n| --- |\n| val |";
    const output = convertMarkdownTablesToHtml(input);
    expect(output).toContain("<caption>Bold Heading</caption>");
  });
});
