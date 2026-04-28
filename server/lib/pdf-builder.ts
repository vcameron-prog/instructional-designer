import puppeteer from "puppeteer-core";
import { execSync } from "child_process";

function findChromiumPath(): string {
  if (process.env.CHROMIUM_PATH) {
    return process.env.CHROMIUM_PATH;
  }
  try {
    return execSync("which chromium", { encoding: "utf-8" }).trim();
  } catch {
    throw new Error(
      "Chromium not found. Install chromium or set the CHROMIUM_PATH environment variable.",
    );
  }
}

const CHROMIUM_PATH = findChromiumPath();

const MAX_HTML_BYTES = 5 * 1024 * 1024;

function stripDangerousElements(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "")
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*\/?>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<iframe\b[^>]*\/>/gi, "")
    .replace(/<link\b[^>]*\/?>/gi, "")
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");
}

export async function buildPdf(
  html: string,
  metadata: { title: string; lang: string; author?: string },
): Promise<Buffer> {
  const byteLength = Buffer.byteLength(html, "utf8");
  if (byteLength > MAX_HTML_BYTES) {
    throw new Error(
      `HTML input too large (${Math.round(byteLength / 1024)} KB; limit ${MAX_HTML_BYTES / 1024} KB)`,
    );
  }

  const sanitizedHtml = stripDangerousElements(html);

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: [
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--font-render-hinting=none",
      ],
    });

    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.isNavigationRequest() && req.url() === "about:blank") {
        req.continue();
        return;
      }
      const url = req.url();
      if (url.startsWith("data:")) {
        req.continue();
        return;
      }
      req.abort("blockedbyclient");
    });

    await page.setJavaScriptEnabled(false);

    const styledHtml = injectPrintStyles(sanitizedHtml, metadata);
    await page.setContent(styledHtml, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<span></span>`,
      footerTemplate: `
        <div style="width:100%;text-align:center;font-size:9px;color:#666;padding:0 40px;">
          <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>
      `,
      margin: {
        top: "0.75in",
        bottom: "0.75in",
        left: "0.75in",
        right: "0.75in",
      },
      tagged: true,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

function injectPrintStyles(
  html: string,
  metadata: { title: string; lang: string; author?: string },
): string {
  const printCss = `
    <style>
      @media print {
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #000; }
        h1, h2, h3, h4, h5, h6 { page-break-after: avoid; margin-top: 1em; }
        table { page-break-inside: avoid; border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #666; padding: 6px 8px; text-align: left; }
        th { background-color: #e8e8e8 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        img { max-width: 100%; height: auto; page-break-inside: avoid; }
        pre, code { font-family: 'Courier New', monospace; font-size: 0.9em; white-space: pre-wrap; }
        a { color: #000; text-decoration: underline; }
        ul, ol { page-break-inside: avoid; }
        p { orphans: 3; widows: 3; }
      }
      body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #222; max-width: 100%; margin: 0; padding: 0; }
      h1 { font-size: 1.8em; margin-bottom: 0.5em; }
      h2 { font-size: 1.4em; margin-bottom: 0.4em; }
      h3 { font-size: 1.2em; margin-bottom: 0.3em; }
      table { border-collapse: collapse; width: 100%; margin: 1em 0; }
      th, td { border: 1px solid #999; padding: 6px 8px; }
      th { background-color: #e8e8e8; font-weight: bold; }
      img { max-width: 100%; height: auto; }
      blockquote { border-left: 3px solid #ccc; margin: 1em 0; padding-left: 1em; color: #555; }
    </style>
  `;

  const escapedTitle = escapeHtml(metadata.title);
  const escapedAuthor = escapeHtml(
    metadata.author || "Accessibility Converter",
  );
  const escapedLang = escapeHtml(metadata.lang);

  const titleTag = `<title>${escapedTitle}</title>`;
  const metaTags = `
    <meta charset="utf-8">
    <meta name="author" content="${escapedAuthor}">
  `;

  let result = html;

  if (!result.includes("<html")) {
    result = `<!DOCTYPE html><html lang="${escapedLang}"><head>${metaTags}${titleTag}${printCss}</head><body>${result}</body></html>`;
  } else {
    const langRegex = /(<html[^>]*)\slang=["'][^"']*["']/i;
    if (langRegex.test(result)) {
      result = result.replace(langRegex, `$1 lang="${escapedLang}"`);
    } else {
      result = result.replace(/<html/i, `<html lang="${escapedLang}"`);
    }

    const headClose = result.indexOf("</head>");
    if (headClose !== -1) {
      if (!/<title[^>]*>/i.test(result)) {
        result =
          result.slice(0, headClose) +
          titleTag +
          metaTags +
          printCss +
          result.slice(headClose);
      } else {
        result =
          result.slice(0, headClose) +
          metaTags +
          printCss +
          result.slice(headClose);
      }
    }
  }

  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
