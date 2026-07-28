import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";

const allowlist = [
  "@anthropic-ai/sdk",
  "connect-pg-simple",
  "date-fns",
  "docx",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-session",
  "memorystore",
  "multer",
  "nodemailer",
  "node-cron",
  "openid-client",
  "p-limit",
  "p-retry",
  "passport",
  "passport-local",
  "pg",
  "uuid",
  "zod",
  "zod-validation-error",
];

async function buildProd() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    // Shim import.meta.url for any bundled ESM packages that reference it at
    // module level. Without this, those packages crash with
    // "fileURLToPath received undefined" when loaded as CJS.
    banner: {
      js: 'const __cjsImportMetaUrl=require("url").pathToFileURL(__filename).href;',
    },
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.url": "__cjsImportMetaUrl",
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildProd().catch((err) => {
  console.error(err);
  process.exit(1);
});
