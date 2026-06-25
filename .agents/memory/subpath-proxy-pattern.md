---
name: Sub-path proxy for co-hosted Express+Vite apps
description: How to serve a second Express+Vite app at /subpath/ off the main deployed app using http-proxy-middleware v3.
---

## Rule
To host a second Express+Vite app (running on its own port) at `/subpath/` on the main deployed URL, use two `http-proxy-middleware` rules registered in the main Express app **before** `registerRoutes()`.

## Required changes (6 files)

### 1. Secondary app's `vite.config.ts`
```ts
base: "/subpath/",
server: {
  proxy: {
    "/subpath/api": {
      target: "http://localhost:<port>",
      changeOrigin: true,
      rewrite: (p) => p.replace(/^\/subpath/, ""),
    },
  },
},
```
The `base` makes Vite emit `/subpath/assets/...` paths in built HTML and dev HTML.  
The self-proxy lets standalone dev access (direct port) work when `VITE_API_BASE_PATH` is set.

### 2. Secondary app's client-side router
Wrap wouter routes with `<Router base="/subpath">`.

### 3. Secondary app's `queryClient.ts`
```ts
const API_BASE = (import.meta.env.VITE_API_BASE_PATH as string) ?? "";
// prefix all fetch(url, ...) calls with API_BASE
```

### 4. Secondary app's env (`.replit` or `.env`)
```
VITE_API_BASE_PATH = "/subpath"
```

### 5. Secondary app's `server/static.ts` (production)
Serve built static files at both `/subpath/` and `/`:
```ts
app.use("/subpath", express.static(distPath));
app.use("/subpath/{*path}", (_req, res) => res.sendFile(...index.html));
app.use(express.static(distPath));
app.use("/{*path}", (_req, res) => res.sendFile(...index.html));
```

### 6. Main app's `server/index.ts` (before `registerRoutes`)
```ts
import { createProxyMiddleware } from "http-proxy-middleware";

// API proxy: Express strips /subpath/api, proxy prepends /api back
app.use("/subpath/api", createProxyMiddleware({
  target: "http://localhost:<secondaryPort>",
  changeOrigin: true,
  pathRewrite: { "^": "/api" },
}));

// HTML/asset proxy: Express strips /subpath, proxy prepends /subpath back
app.use("/subpath", createProxyMiddleware({
  target: "http://localhost:<secondaryPort>",
  changeOrigin: true,
  pathRewrite: { "^": "/subpath" },
}));
```

**Why the double-mount trick works:**
- `app.use('/subpath/api', proxy)` → Express strips `/subpath/api`, proxy receives `/courses`. `pathRewrite: { "^": "/api" }` inserts `/api` at start → `/api/courses`. ✓
- `app.use('/subpath', proxy)` → Express strips `/subpath`, proxy receives `/assets/main.js`. `pathRewrite: { "^": "/subpath" }` inserts `/subpath` → `/subpath/assets/main.js`. The secondary Vite dev server (with `base: "/subpath/"`) serves this correctly. ✓

**Why:** The secondary app needs `base: "/subpath/"` so built HTML emits absolute paths from `/subpath/`. Without it, asset paths are root-relative and get served by the main app instead of proxied.

**How to apply:** Any time you need to co-host two full-stack Vite apps under one domain without separate Replit deployments.
