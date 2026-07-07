import express, { type Express, type Request, type Response } from "express";
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

interface RouteMeta {
  title: string;
  description: string;
  bodyContent: string;
}

const PUBLIC_ROUTE_META: Record<string, RouteMeta> = {
  "/faculty": {
    title: "BSU Instructional Designer | Bridgewater State University",
    description:
      "AI-powered instructional design tool for BSU faculty. Generate UDL-aligned course materials, assignments, rubrics, syllabi, and learning modules using Claude AI.",
    bodyContent: `
      <main id="main-content">
        <h1>Instructional Designer</h1>
        <p>AI-powered instructional design tool for Bridgewater State University faculty.
           Generate UDL-aligned course materials, assignments, rubrics, syllabi, and learning modules.</p>
        <section aria-labelledby="tools-heading">
          <h2 id="tools-heading">Available Tools</h2>
          <ul>
            <li><strong>Accessibility Converter</strong> &mdash; Convert PDFs, Word documents, and Google Docs
                into WCAG 2.1 AA compliant accessible documents</li>
            <li><strong>Quick Tools</strong> &mdash; Generate individual course materials without creating a full course</li>
            <li><strong>Course Designer</strong> &mdash; Design a complete course with AI-generated materials
                including syllabi, assignments, rubrics, and learning modules</li>
          </ul>
        </section>
        <section aria-labelledby="features-heading">
          <h2 id="features-heading">Key Features</h2>
          <ul>
            <li>Universal Design for Learning (UDL) frameworks built in</li>
            <li>Cultural Relevance &amp; Inclusivity integration</li>
            <li>Social-Emotional Learning (SEL) frameworks</li>
            <li>BSU syllabus template compliance</li>
            <li>AI Policy generation using BSU&rsquo;s 4-level framework</li>
            <li>Professional DOCX export for Blackboard Ultra</li>
          </ul>
        </section>
      </main>`,
  },
  "/faculty/bsu": {
    title: "BSU Instructional Designer | Bridgewater State University",
    description:
      "AI-powered instructional design tool for BSU faculty. Generate UDL-aligned course materials, assignments, rubrics, syllabi, and learning modules using Claude AI.",
    bodyContent: `
      <main id="main-content">
        <h1>Instructional Designer</h1>
        <p>AI-powered instructional design tool for Bridgewater State University faculty.
           Generate UDL-aligned course materials, assignments, rubrics, syllabi, and learning modules.</p>
        <section aria-labelledby="tools-heading">
          <h2 id="tools-heading">Available Tools</h2>
          <ul>
            <li><strong>Accessibility Converter</strong> &mdash; Convert PDFs, Word documents, and Google Docs
                into WCAG 2.1 AA compliant accessible documents</li>
            <li><strong>Quick Tools</strong> &mdash; Generate individual course materials without creating a full course</li>
            <li><strong>Course Designer</strong> &mdash; Design a complete course with AI-generated materials</li>
          </ul>
        </section>
      </main>`,
  },
  "/faculty/help": {
    title: "Help & Resources | BSU Instructional Designer",
    description:
      "Step-by-step guidance and FAQs for using the BSU AI instructional design tools. Learn how to generate UDL-aligned course materials.",
    bodyContent: `
      <main id="main-content">
        <h1>Help &amp; Resources</h1>
        <p>Step-by-step guidance and FAQs for using the BSU AI instructional design tools.
           Learn how to generate UDL-aligned course materials for your courses.</p>
        <section aria-labelledby="help-tools-heading">
          <h2 id="help-tools-heading">Available Course Tools</h2>
          <ul>
            <li><strong>Syllabus Generator</strong> &mdash; Creates a comprehensive syllabus following BSU guidelines</li>
            <li><strong>Course Schedule</strong> &mdash; Generates a week-by-week schedule aligned with BSU&rsquo;s academic calendar</li>
            <li><strong>Assignment Builder</strong> &mdash; Creates detailed assignment instructions with inclusive design frameworks</li>
            <li><strong>Learning Module Designer</strong> &mdash; Structures learning modules with activities, resources, and assessments</li>
            <li><strong>Rubric Generator</strong> &mdash; Creates detailed assessment rubrics with clear criteria and levels</li>
            <li><strong>AI Policy Generator</strong> &mdash; Creates a clear AI use policy using BSU&rsquo;s 4-level framework</li>
          </ul>
        </section>
        <section aria-labelledby="help-udl-heading">
          <h2 id="help-udl-heading">Inclusive Design Frameworks</h2>
          <ul>
            <li>Universal Design for Learning (UDL) &mdash; multiple means of representation, action &amp; expression, and engagement</li>
            <li>Cultural Relevance &amp; Inclusivity &mdash; culturally responsive teaching practices</li>
            <li>Social-Emotional Learning (SEL) &mdash; self-regulation, motivation, and relationship-building</li>
          </ul>
        </section>
      </main>`,
  },
  "/faculty/research": {
    title: "Research & Theory | BSU Instructional Designer",
    description:
      "Research, theory, and accessibility guidance for BSU faculty. UDL, Cultural Relevance, SEL, and AI pedagogy resources.",
    bodyContent: `
      <main id="main-content">
        <h1>Research &amp; Theory</h1>
        <p>Research, theory, and accessibility guidance for BSU faculty using the instructional design tools.
           Explore evidence-based frameworks for UDL, Cultural Relevance, SEL, and AI-enhanced pedagogy.</p>
        <section aria-labelledby="research-accessibility-heading">
          <h2 id="research-accessibility-heading">Accessibility &amp; Universal Design</h2>
          <ul>
            <li>WCAG 2.1 (Web Content Accessibility Guidelines) &mdash; international standard for digital accessibility</li>
            <li>UDL Guidelines (CAST) &mdash; universal design principles for higher education</li>
            <li>BSU Student Accessibility Services</li>
            <li>Section 508 federal accessibility requirements</li>
          </ul>
        </section>
        <section aria-labelledby="research-ai-heading">
          <h2 id="research-ai-heading">AI in Higher Education</h2>
          <ul>
            <li>Evidence-based approaches for integrating AI tools into teaching and learning</li>
            <li>Practical frameworks for AI-assisted practice, feedback, and Socratic dialogue</li>
            <li>UNESCO framework for ethical AI use in educational settings</li>
            <li>BSU Center for Artificial Intelligence resources</li>
          </ul>
        </section>
        <section aria-labelledby="research-integrity-heading">
          <h2 id="research-integrity-heading">Academic Integrity in the AI Era</h2>
          <p>Explores how academic integrity must evolve beyond plagiarism detection to embrace
             authentic assessment in the age of generative AI.</p>
        </section>
      </main>`,
  },
  "/faculty/accessibility-tools": {
    title: "Accessibility Tools | BSU Instructional Designer",
    description:
      "Suite of AI-powered accessibility tools for BSU faculty, including URL scanner, color contrast checker, alt text generator, and math OCR.",
    bodyContent: `
      <main id="main-content">
        <h1>Accessibility Tools</h1>
        <p>Suite of AI-powered accessibility tools for BSU faculty. Check and improve the accessibility
           of your course materials and web content.</p>
        <section aria-labelledby="tools-list-heading">
          <h2 id="tools-list-heading">Available Tools</h2>
          <ul>
            <li><strong>URL Accessibility Scanner</strong> &mdash; Scan any web page for WCAG 2.1 AA violations</li>
            <li><strong>Color Contrast Checker</strong> &mdash; Verify text and background color contrast ratios</li>
            <li><strong>Alt Text Generator</strong> &mdash; AI-generated image descriptions for WCAG 2.1 compliance</li>
            <li><strong>Math OCR</strong> &mdash; Convert math equation images to accessible text and LaTeX</li>
          </ul>
        </section>
      </main>`,
  },
  "/faculty/accessibility-tools/url-scanner": {
    title: "URL Accessibility Scanner | BSU Instructional Designer",
    description:
      "Scan any web page URL for accessibility issues against WCAG 2.1 AA standards. Identify and fix barriers for students with disabilities.",
    bodyContent: `
      <main id="main-content">
        <h1>URL Accessibility Scanner</h1>
        <p>Scan any web page URL for accessibility issues against WCAG 2.1 AA standards.
           Identify and fix barriers for students with disabilities.</p>
        <section aria-labelledby="scanner-checks-heading">
          <h2 id="scanner-checks-heading">What Gets Scanned</h2>
          <ul>
            <li>Missing or inadequate image alt text</li>
            <li>Improper heading hierarchy and structure</li>
            <li>Color contrast ratios below WCAG 2.1 AA thresholds</li>
            <li>Missing ARIA labels and landmark regions</li>
            <li>Keyboard navigation barriers</li>
            <li>Form label associations</li>
          </ul>
        </section>
      </main>`,
  },
  "/faculty/accessibility-tools/color-contrast": {
    title: "Color Contrast Checker | BSU Instructional Designer",
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
  "/faculty/accessibility-tools/alt-text": {
    title: "Alt Text Generator | BSU Instructional Designer",
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
            <li>Copy and use the description in your course materials</li>
          </ol>
        </section>
      </main>`,
  },
  "/faculty/accessibility-tools/math-ocr": {
    title: "Math OCR | BSU Instructional Designer",
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
};

const SITE_BASE_URL = "https://bsu-accessibility-tool.replit.app";

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
      `<div id="root">${meta.bodyContent}</div>`,
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

  function sendEnrichedOrFallback(res: Response, facultyPath: string): void {
    const meta = PUBLIC_ROUTE_META[facultyPath];
    if (meta) {
      const canonicalUrl = `${SITE_BASE_URL}${facultyPath}`;
      const enriched = injectMeta(getBaseHtml(), meta, canonicalUrl);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(enriched);
    } else {
      res.sendFile(indexPath);
    }
  }

  // Intercept public /faculty/* paths BEFORE static middleware so that routes
  // like /faculty and /faculty/ (which express.static would serve as index.html
  // directly) also receive route-specific metadata and body content.
  app.use("/faculty", (req: Request, res: Response, next) => {
    const subPath = req.path === "/" ? "" : req.path;
    const facultyPath = `/faculty${subPath}`;
    if (facultyPath in PUBLIC_ROUTE_META) {
      sendEnrichedOrFallback(res, facultyPath);
    } else {
      next();
    }
  });

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

  // Intercept public paths for direct access (without /faculty prefix)
  app.use((req: Request, res: Response, next) => {
    const subPath = req.path === "/" ? "" : req.path;
    const facultyPath = `/faculty${subPath}`;
    if (facultyPath in PUBLIC_ROUTE_META) {
      sendEnrichedOrFallback(res, facultyPath);
    } else {
      next();
    }
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
