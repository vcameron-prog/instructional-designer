import express, { type Express, type Request, type Response } from "express";
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

interface RouteMeta {
  title: string;
  description: string;
  bodyContent: string;
}

const PUBLIC_ROUTE_META: Record<string, RouteMeta> = {
  "/": {
    title: "BSU Accessibility Tool | Bridgewater State University",
    description:
      "AI-powered accessibility converter for BSU faculty. Convert PDF, Word, and Google Docs documents to WCAG 2.1 AA compliant HTML using Claude AI.",
    bodyContent: `
      <main id="main-content">
        <h1>BSU Accessibility &amp; Instructional Design Tools</h1>
        <section aria-labelledby="id-section-heading">
          <h2 id="id-section-heading">AI-Powered Course Design for BSU Faculty</h2>
          <p>Create assignments, rubrics, syllabi, and UDL-aligned course materials in minutes &mdash;
             powered by AI and built specifically for Bridgewater State University instructors.</p>
          <ul>
            <li>AI-Generated Course Materials &mdash; assignments, rubrics, syllabi &amp; learning modules</li>
            <li>UDL &amp; Inclusive Design &mdash; cultural relevance &amp; SEL frameworks built in</li>
            <li>Built for BSU Faculty &mdash; BSU syllabus template &amp; DOCX export</li>
          </ul>
          <a href="/faculty">Open Instructional Designer</a>
        </section>
        <section aria-labelledby="converter-section-heading">
          <h2 id="converter-section-heading">Accessibility Converter</h2>
          <p>Convert PDF, Word, PowerPoint, Excel, and Google Docs to WCAG 2.1 AA compliant accessible HTML.
             No login required &mdash; free to use instantly.</p>
          <ul>
            <li>Supports PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), and Google Docs</li>
            <li>AI-powered remediation: alt text, heading structure, reading order</li>
            <li>Download as accessible HTML, Word (.docx), or tagged PDF</li>
          </ul>
          <a href="/pdf-accessibility">Convert a Document</a>
        </section>
      </main>`,
  },
  "/accessibility": {
    title: "Accessibility Converter | BSU Accessibility Tool",
    description:
      "Convert PDF, Word (.docx), Excel, PowerPoint, and Google Docs to WCAG 2.1 AA compliant accessible HTML. ADA Title II document remediation for BSU faculty.",
    bodyContent: `
      <main id="main-content">
        <h1>Accessibility Converter</h1>
        <p>Convert PDF, Word (.docx), Excel, PowerPoint, and Google Docs to WCAG 2.1 AA compliant accessible HTML.
           AI-powered document remediation for ADA Title II compliance.</p>
        <section aria-labelledby="how-it-works-heading">
          <h2 id="how-it-works-heading">How It Works</h2>
          <ol>
            <li>Upload your file (PDF, Word, Excel, PowerPoint) or paste a Google Docs URL</li>
            <li>AI analyzes your document for accessibility barriers</li>
            <li>Review the compliance report and apply AI-suggested fixes</li>
            <li>Download as accessible HTML, Word (.docx), or tagged PDF</li>
          </ol>
        </section>
        <section aria-labelledby="what-checked-heading">
          <h2 id="what-checked-heading">What Gets Checked</h2>
          <ul>
            <li>Image alt text descriptions (WCAG 2.1 AA)</li>
            <li>Heading structure and reading order</li>
            <li>Table headers and accessible structure</li>
            <li>Color contrast ratios</li>
          </ul>
        </section>
      </main>`,
  },
  "/pdf-accessibility": {
    title: "Accessibility Converter | BSU Accessibility Tool",
    description:
      "Convert PDF, Word (.docx), Excel, PowerPoint, and Google Docs to WCAG 2.1 AA compliant accessible HTML. ADA Title II document remediation for BSU faculty.",
    bodyContent: `
      <main id="main-content">
        <h1>Accessibility Converter</h1>
        <p>Convert PDF, Word (.docx), Excel, PowerPoint, and Google Docs to WCAG 2.1 AA compliant accessible HTML.
           AI-powered document remediation for ADA Title II compliance.</p>
        <section aria-labelledby="how-it-works-heading">
          <h2 id="how-it-works-heading">How It Works</h2>
          <ol>
            <li>Upload your file (PDF, Word, Excel, PowerPoint) or paste a Google Docs URL</li>
            <li>AI analyzes your document for accessibility barriers</li>
            <li>Review the compliance report and apply AI-suggested fixes</li>
            <li>Download as accessible HTML, Word (.docx), or tagged PDF</li>
          </ol>
        </section>
        <section aria-labelledby="what-checked-heading">
          <h2 id="what-checked-heading">What Gets Checked</h2>
          <ul>
            <li>Image alt text descriptions (WCAG 2.1 AA)</li>
            <li>Heading structure and reading order</li>
            <li>Table headers and accessible structure</li>
            <li>Color contrast ratios</li>
          </ul>
        </section>
      </main>`,
  },
  "/pdf-accessibility/faq": {
    title: "Accessibility Converter FAQ | BSU Accessibility Tool",
    description:
      "Frequently asked questions about the BSU accessibility converter, WCAG 2.1 AA compliance, and AI-powered document remediation tools.",
    bodyContent: `
      <main id="main-content">
        <h1>Accessibility Converter FAQ</h1>
        <p>Frequently asked questions about the BSU accessibility converter, WCAG 2.1 AA compliance, and AI-powered document remediation.</p>
        <section aria-labelledby="faq-what-heading">
          <h2 id="faq-what-heading">What is the Accessibility Converter?</h2>
          <p>This tool converts PDF, Word (.docx), and Google Docs documents into more accessible HTML files,
             applying the structural and descriptive features that ADA Title II and WCAG 2.1 Level AA require.
             It uses AI to analyze document structure and add proper headings, image descriptions,
             reading order, and other accessibility features.</p>
        </section>
        <section aria-labelledby="faq-formats-heading">
          <h2 id="faq-formats-heading">What file types are supported?</h2>
          <p>PDF files, Word documents (.docx), Excel spreadsheets (.xlsx), PowerPoint presentations (.pptx),
             and Google Docs, Sheets, and Slides (via publicly shared URL).</p>
        </section>
        <section aria-labelledby="faq-ai-heading">
          <h2 id="faq-ai-heading">How does the AI fix accessibility issues?</h2>
          <p>The AI scans for common barriers &mdash; missing image descriptions (alt text), improper heading levels,
             tables without headers, and untagged content &mdash; and rewrites or restructures those elements
             so assistive technology can interpret the document correctly.</p>
        </section>
        <section aria-labelledby="faq-output-heading">
          <h2 id="faq-output-heading">What export formats are available?</h2>
          <p>You can download the remediated document as accessible HTML, a Word (.docx) file,
             or a tagged PDF suitable for screen readers and assistive technologies.</p>
        </section>
      </main>`,
  },
  "/accessibility-tools/url-scanner": {
    title: "URL Accessibility Scanner | BSU Accessibility Tool",
    description:
      "Scan any web page URL for accessibility issues against WCAG 2.1 AA standards. Identify and fix barriers for users with disabilities.",
    bodyContent: `
      <main id="main-content">
        <h1>URL Accessibility Scanner</h1>
        <p>Scan any web page URL for accessibility issues against WCAG 2.1 AA standards.
           Identify barriers for users with disabilities and get actionable recommendations.</p>
        <section aria-labelledby="scanner-checks-heading">
          <h2 id="scanner-checks-heading">What Gets Scanned</h2>
          <ul>
            <li>Missing or inadequate image alt text</li>
            <li>Improper heading hierarchy</li>
            <li>Color contrast issues</li>
            <li>Missing ARIA labels and landmark regions</li>
            <li>Keyboard navigation barriers</li>
            <li>Form label associations</li>
          </ul>
        </section>
      </main>`,
  },
  "/accessibility-tools/color-contrast": {
    title: "Color Contrast Checker | BSU Accessibility Tool",
    description:
      "Check text and background color combinations for WCAG 2.1 AA contrast compliance. Ensure your course materials meet accessibility standards.",
    bodyContent: `
      <main id="main-content">
        <h1>Color Contrast Checker</h1>
        <p>Check text and background color combinations for WCAG 2.1 AA contrast compliance.
           Ensure your course materials and web content meet accessibility standards for all learners.</p>
        <section aria-labelledby="contrast-ratios-heading">
          <h2 id="contrast-ratios-heading">WCAG 2.1 Contrast Requirements</h2>
          <ul>
            <li>Normal text: minimum contrast ratio of 4.5:1</li>
            <li>Large text (18pt or 14pt bold): minimum ratio of 3:1</li>
            <li>UI components and graphics: minimum ratio of 3:1</li>
          </ul>
        </section>
      </main>`,
  },
  "/accessibility-tools/alt-text": {
    title: "Alt Text Generator | BSU Accessibility Tool",
    description:
      "Generate AI-powered alternative text descriptions for images following WCAG 2.1 guidelines. Make your visual content accessible to all learners.",
    bodyContent: `
      <main id="main-content">
        <h1>Alt Text Generator</h1>
        <p>Generate AI-powered alternative text descriptions for images following WCAG 2.1 guidelines.
           Make your visual content accessible to screen reader users and all learners.</p>
        <section aria-labelledby="alt-text-how-heading">
          <h2 id="alt-text-how-heading">How It Works</h2>
          <ol>
            <li>Upload an image (PNG, JPG, JPEG, GIF, WebP)</li>
            <li>AI analyzes the image content and context</li>
            <li>Receive a descriptive alt text following WCAG 2.1 guidelines</li>
            <li>Copy and use the generated description in your course materials</li>
          </ol>
        </section>
      </main>`,
  },
  "/accessibility-tools/math-ocr": {
    title: "Math OCR | BSU Accessibility Tool",
    description:
      "Extract and convert mathematical equations from images to accessible text and LaTeX. Make math content readable by screen readers and assistive technologies.",
    bodyContent: `
      <main id="main-content">
        <h1>Math OCR</h1>
        <p>Extract and convert mathematical equations from images to accessible text and LaTeX notation.
           Make math content readable by screen readers and assistive technologies.</p>
        <section aria-labelledby="math-ocr-how-heading">
          <h2 id="math-ocr-how-heading">How It Works</h2>
          <ol>
            <li>Upload an image containing mathematical equations or expressions</li>
            <li>AI extracts the math content using optical character recognition</li>
            <li>Receive the equation in plain text and LaTeX format</li>
            <li>Use the accessible text in your course materials</li>
          </ol>
        </section>
      </main>`,
  },
  "/help": {
    title: "Help & Resources | BSU Accessibility Tool",
    description:
      "Step-by-step guidance for using the BSU accessibility converter and accessibility tools. Learn how to make your course materials ADA compliant.",
    bodyContent: `
      <main id="main-content">
        <h1>Help &amp; Resources</h1>
        <p>Step-by-step guidance for using the BSU accessibility converter and accessibility tools.
           Learn how to make your course materials ADA Title II and WCAG 2.1 AA compliant.</p>
        <section aria-labelledby="help-steps-heading">
          <h2 id="help-steps-heading">How to Use the Accessibility Converter</h2>
          <ol>
            <li><strong>Upload your document</strong> &mdash; drag and drop or browse to select a PDF,
                Word, Excel, PowerPoint, or paste a Google Docs URL</li>
            <li><strong>AI analysis</strong> &mdash; the tool checks reading order, headings, tables,
                images, and color contrast against WCAG 2.1 AA</li>
            <li><strong>Review issues</strong> &mdash; see a full list of issues with severity levels
                and AI-suggested fixes</li>
            <li><strong>Download</strong> &mdash; export the remediated document as HTML, DOCX, or tagged PDF</li>
          </ol>
        </section>
        <section aria-labelledby="help-stats-heading">
          <h2 id="help-stats-heading">Processing Details</h2>
          <ul>
            <li>Typical processing time: 1&ndash;2 minutes</li>
            <li>Accessibility standard: WCAG 2.1 AA</li>
            <li>Export formats: HTML, DOCX, Tagged PDF</li>
          </ul>
        </section>
      </main>`,
  },
};

function injectMeta(html: string, meta: RouteMeta, canonicalUrl: string): string {
  const headTags = `
    <title>${meta.title}</title>
    <meta name="description" content="${meta.description}" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${canonicalUrl}" />
    <meta property="og:title" content="${meta.title}" />
    <meta property="og:description" content="${meta.description}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${meta.title}" />
    <meta name="twitter:description" content="${meta.description}" />`;

  return html
    .replace(/<title>[^<]*<\/title>/, "")
    .replace(/<meta name="description"[^>]*\/?>/, "")
    .replace(/<meta name="robots"[^>]*\/?>/, "")
    .replace("</head>", `${headTags}\n  </head>`)
    .replace(
      '<div id="root"></div>',
      `<div id="root"><div style="display:none" aria-hidden="true">${meta.bodyContent}</div></div>`,
    );
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const indexPath = path.resolve(distPath, "index.html");
  let baseHtml: string | null = null;

  function getBaseHtml(): string {
    if (!baseHtml) {
      baseHtml = fs.readFileSync(indexPath, "utf-8");
    }
    return baseHtml;
  }

  // Intercept known public routes BEFORE express.static so that routes like
  // "/" (which express.static would serve as index.html directly) also get
  // route-specific metadata and body content injected.
  app.use((req: Request, res: Response, next) => {
    const routePath = req.path || "/";
    if (routePath in PUBLIC_ROUTE_META) {
      const meta = PUBLIC_ROUTE_META[routePath]!;
      const origin = `${req.protocol}://${req.get("host")}`;
      const canonicalUrl = `${origin}${routePath}`;
      const enriched = injectMeta(getBaseHtml(), meta, canonicalUrl);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(enriched);
    } else {
      next();
    }
  });

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist, with 404 for unknown SPA routes
  app.use("/{*path}", (req, res) => {
    const urlPath = req.path;
    if (!isValidSpaRoute(urlPath)) {
      res.status(404).sendFile(path.resolve(distPath, "index.html"));
      return;
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
