import express, { type Express } from "express";
import fs from "fs";
import path from "path";

const VALID_ROUTE_PATTERNS = [
  /^\/$/,
  /^\/accessibility$/,
  /^\/pdf-accessibility(\/faq|\/history|\/[^/]+)?$/,
  /^\/accessibility-tools\/(url-scanner|color-contrast|alt-text|math-ocr)$/,
  /^\/settings$/,
  /^\/help$/,
  /^\/admin$/,
];

function isValidSpaRoute(urlPath: string): boolean {
  return VALID_ROUTE_PATTERNS.some((pattern) => pattern.test(urlPath));
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  app.use("/{*path}", (req, res) => {
    const urlPath = req.path;
    if (!isValidSpaRoute(urlPath)) {
      res.status(404).sendFile(path.resolve(distPath, "index.html"));
      return;
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
