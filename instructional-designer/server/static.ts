import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Serve at /faculty/ prefix — used when accessed via the main app proxy
  app.use("/faculty", express.static(distPath));
  app.use("/faculty/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });

  // Also serve at root for direct access
  app.use(express.static(distPath));
  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
