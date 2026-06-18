export const EXTRACTION_ERROR_MESSAGES: Record<string, string> = {
  "google-sheet": "This Google Sheet could not be read. It may be in an unsupported format or corrupted.",
  xlsx: "This Excel spreadsheet could not be read. It may be corrupted, password-protected, or in an unsupported format.",
  pptx: "This PowerPoint file could not be read. It may be corrupted, password-protected, or in an unsupported format.",
  "google-slide": "This Google Slides file could not be read. It may be in an unsupported format or corrupted.",
  docx: "This Word document could not be read. It may be corrupted, password-protected, or in an unsupported format.",
  "google-doc": "This Google Doc could not be extracted. It may be in an unsupported format or corrupted.",
  doc: "This file could not be read. It may be corrupted or in an unsupported variant of the .doc format.",
  rtf: "This RTF file could not be read. It may be corrupted or in an unsupported format.",
  html: "This HTML file could not be parsed. Check that it is a valid HTML document.",
  odt: "This OpenDocument Text file could not be read. It may be corrupted or in an unsupported format.",
  ods: "This OpenDocument Spreadsheet could not be read. It may be corrupted or in an unsupported format.",
  odp: "This OpenDocument Presentation could not be read. It may be corrupted or in an unsupported format.",
  epub: "This EPUB file could not be opened. It may be corrupted or not a valid EPUB.",
  csv: "This CSV file could not be parsed. Check that it is a valid, well-formed CSV file.",
  pdf: "This PDF could not be read. It may be corrupted, password-protected, or not a valid PDF.",
};

export const EXTRACTION_ERROR_FALLBACK =
  "This file could not be read. It may be corrupted or in an unsupported format.";
