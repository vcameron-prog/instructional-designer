import express, { type Express } from "express";
import fs from "fs";
import path from "path";

const VALID_ROUTE_PATTERNS = [
  /^\/$/,
  /^\/bsu$/,
  /^\/new-course$/,
  /^\/course\/[^/]+(\/edit|\/tools|\/tool\/[^/]+|\/result\/[^/]+|\/result-batch\/[^/]+\/[^/]+)$/,
  /^\/quick-tools(\/result\/[^/]+|\/result-batch\/[^/]+\/[^/]+|\/[^/]+)?$/,
  /^\/admin$/,
  /^\/settings$/,
  /^\/help$/,
  /^\/research$/,
  /^\/library$/,
  /^\/accessibility-tools(\/url-scanner|\/color-contrast|\/alt-text|\/math-ocr)?$/,
];

function isValidSpaRoute(urlPath: string): boolean {
  return VALID_ROUTE_PATTERNS.some((pattern) => pattern.test(urlPath));
}

function isValidFacultySpaRoute(urlPath: string): boolean {
  // Strip leading /faculty prefix, then validate the remainder as a normal route
  const stripped = urlPath.replace(/^\/faculty/, "") || "/";
  return isValidSpaRoute(stripped);
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Serve at /faculty/ prefix — used when accessed via the main app proxy
  app.use("/faculty", express.static(distPath));
  app.use("/faculty/{*path}", (req, res) => {
    const fullPath = `/faculty${req.path}`;
    if (!isValidFacultySpaRoute(fullPath)) {
      res.status(404).sendFile(path.resolve(distPath, "index.html"));
      return;
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });

  // Also serve at root for direct access
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
