import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  test: {
    globals: true,
    include: [
      "server/**/*.test.ts",
      "client/src/lib/**/*.test.{ts,tsx}",
      "client/src/components/**/*.test.tsx",
    ],
    environmentMatchGlobs: [
      ["client/src/components/**", "jsdom"],
      ["client/src/lib/**/*.test.tsx", "jsdom"],
    ],
    environment: "node",
  },
});
