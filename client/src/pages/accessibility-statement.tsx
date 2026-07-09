import { useEffect } from "react";
import { Link } from "wouter";
import { usePageTitle } from "@/hooks/use-page-title";
import { HeaderControls } from "@/components/header-controls";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { Shield, CheckCircle, AlertCircle, Mail, ExternalLink } from "lucide-react";

export default function AccessibilityStatementPage() {
  usePageTitle(
    "Accessibility Statement — BSU CAI Accessibility Tools",
    "Accessibility statement for the BSU Center for Artificial Intelligence Accessibility Tools. WCAG 2.1 AA conformance status, known limitations, and how to report accessibility barriers.",
  );
  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-20">
        <div className="container mx-auto px-4 py-2 flex items-center justify-end">
          <nav aria-label="Site navigation">
            <HeaderControls showLibrary={false} showHelp={false} showSettings={false} />
          </nav>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 container mx-auto px-4 py-12 max-w-3xl">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
            </div>
            <h1 className="text-3xl font-bold text-foreground">Accessibility Statement</h1>
          </div>
          <p className="text-muted-foreground">
            Bridgewater State University Center for Artificial Intelligence (BSU CAI) is committed to
            ensuring digital accessibility for people with disabilities. We continually improve the
            user experience for everyone and apply relevant accessibility standards.
          </p>
        </div>

        <div className="space-y-8">
          <section aria-labelledby="conformance-heading">
            <h2 id="conformance-heading" className="text-xl font-semibold text-foreground mb-3 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              Conformance Status
            </h2>
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl space-y-2">
              <p className="text-foreground">
                <strong>Target standard:</strong>{" "}
                <a
                  href="https://www.w3.org/WAI/WCAG21/Understanding/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:opacity-80 inline-flex items-center gap-1"
                >
                  Web Content Accessibility Guidelines (WCAG) 2.1 Level AA
                  <ExternalLink className="w-3 h-3" aria-label="(opens in new tab)" />
                </a>
              </p>
              <p className="text-foreground">
                <strong>Conformance status:</strong> Partially conformant — the BSU CAI Accessibility
                Tools aim to conform to WCAG 2.1 AA. Known exceptions are listed below.
              </p>
              <p className="text-foreground">
                <strong>Date of last audit:</strong> July 2026
              </p>
              <p className="text-foreground">
                <strong>Applicable regulation:</strong> ADA Title II (effective April 24, 2026)
                requires public-sector entities to meet WCAG 2.1 AA for digital content.
              </p>
            </div>
          </section>

          <section aria-labelledby="measures-heading">
            <h2 id="measures-heading" className="text-xl font-semibold text-foreground mb-3">
              Measures Taken to Support Accessibility
            </h2>
            <ul className="space-y-2 text-foreground list-disc list-outside pl-5">
              <li>Skip-to-main-content link at the top of every page for keyboard users</li>
              <li>Dyslexia-friendly Atkinson Hyperlegible font as the primary typeface</li>
              <li>User-adjustable font size controls in the page header</li>
              <li>Light and dark color modes, both designed to meet WCAG contrast requirements</li>
              <li>ARIA landmark regions, live regions, and descriptive labels throughout</li>
              <li>Focus management on route transitions to announce new page content to screen readers</li>
              <li>All animations respect the <code className="text-xs bg-muted px-1 py-0.5 rounded">prefers-reduced-motion</code> media query</li>
              <li>All form fields have programmatic labels; error messages are linked to their field via <code className="text-xs bg-muted px-1 py-0.5 rounded">aria-describedby</code></li>
              <li>All icon-only buttons carry an <code className="text-xs bg-muted px-1 py-0.5 rounded">aria-label</code></li>
              <li>All non-decorative images carry descriptive <code className="text-xs bg-muted px-1 py-0.5 rounded">alt</code> attributes</li>
              <li>Data tables include column-scope headers</li>
              <li>Keyboard-operable file upload dropzones with Enter/Space activation</li>
              <li>Modal dialogs trap focus while open and return focus to the trigger on close (Radix UI primitives)</li>
            </ul>
          </section>

          <section aria-labelledby="known-limitations-heading">
            <h2 id="known-limitations-heading" className="text-xl font-semibold text-foreground mb-3 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              Known Limitations
            </h2>
            <div className="space-y-3">
              <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
                <p className="font-medium text-foreground mb-1">Rich-text editor toolbar (document conversion page)</p>
                <p className="text-sm text-muted-foreground">
                  The TipTap-based rich-text editor used to edit converted documents may not expose
                  all toolbar actions to screen readers via the ARIA authoring practices pattern for
                  toolbars. Keyboard users can still access all editing functions via standard
                  keyboard shortcuts (Ctrl+B, Ctrl+I, etc.).
                </p>
              </div>
              <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
                <p className="font-medium text-foreground mb-1">Charts and data visualizations</p>
                <p className="text-sm text-muted-foreground">
                  Recharts-based pie and bar charts on the Admin Dashboard are rendered as SVG.
                  Each chart includes a textual <code className="text-xs bg-muted px-1 py-0.5 rounded">aria-label</code> summarizing
                  the data; the underlying data is also available in adjacent tables or lists.
                  Interactive chart tooltips may not be reachable by keyboard alone.
                </p>
              </div>
              <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
                <p className="font-medium text-foreground mb-1">Third-party authentication (Replit Auth)</p>
                <p className="text-sm text-muted-foreground">
                  The sign-in flow is handled by Replit's OpenID Connect provider. Accessibility of
                  the external authentication pages is outside BSU CAI's direct control.
                </p>
              </div>
              <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
                <p className="font-medium text-foreground mb-1">Generated and exported documents</p>
                <p className="text-sm text-muted-foreground">
                  The accessibility of documents <em>generated by</em> this tool (downloaded HTML,
                  DOCX, or tagged PDF exports) is the subject of the tool's core conversion pipeline,
                  not this statement. Always review AI-remediated output before distributing it.
                </p>
              </div>
            </div>
          </section>

          <section aria-labelledby="testing-heading">
            <h2 id="testing-heading" className="text-xl font-semibold text-foreground mb-3">
              Technical Specification &amp; Testing
            </h2>
            <p className="text-foreground mb-3">
              The BSU CAI Accessibility Tools rely on the following technologies:
            </p>
            <ul className="list-disc list-outside pl-5 space-y-1 text-foreground mb-4">
              <li>HTML5, CSS3, and ARIA</li>
              <li>React 18 with Radix UI primitives</li>
              <li>TipTap (ProseMirror) for rich-text editing</li>
              <li>Recharts for data visualizations</li>
            </ul>
            <p className="text-foreground">
              Accessibility is assessed using automated tooling (axe-core via Playwright) covering
              all audited routes, supplemented by manual keyboard and screen-reader testing.
            </p>
          </section>

          <section aria-labelledby="contact-heading">
            <h2 id="contact-heading" className="text-xl font-semibold text-foreground mb-3 flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" aria-hidden="true" />
              Feedback &amp; Contact
            </h2>
            <div className="p-4 bg-card border border-border rounded-xl space-y-3">
              <p className="text-foreground">
                We welcome your feedback on the accessibility of the BSU CAI Accessibility Tools.
                If you encounter a barrier that prevents you from using any part of this tool,
                please let us know and we will work to resolve it promptly.
              </p>
              <p className="text-foreground">
                <strong>Email:</strong>{" "}
                <a
                  href="mailto:accessibility@bridgew.edu"
                  className="underline underline-offset-2 hover:opacity-80"
                >
                  accessibility@bridgew.edu
                </a>
              </p>
              <p className="text-sm text-muted-foreground">
                We aim to respond to accessibility feedback within 3 business days.
              </p>
              <p className="text-sm text-muted-foreground">
                If you are not satisfied with our response, you may contact the{" "}
                <a
                  href="https://www.ada.gov/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:opacity-80 inline-flex items-center gap-1"
                >
                  U.S. Department of Justice ADA Information Line
                  <ExternalLink className="w-3 h-3" aria-label="(opens in new tab)" />
                </a>
                {" "}at 1-800-514-0301 (voice) or 1-800-514-0383 (TTY).
              </p>
            </div>
          </section>

          <section aria-labelledby="formal-complaints-heading">
            <h2 id="formal-complaints-heading" className="text-xl font-semibold text-foreground mb-3">
              Formal Complaints
            </h2>
            <p className="text-foreground">
              Bridgewater State University's ADA/Section 504 Coordinator handles formal accessibility
              complaints. Contact information is available on the{" "}
              <a
                href="https://www.bridgew.edu"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:opacity-80 inline-flex items-center gap-1"
              >
                Bridgewater State University website
                <ExternalLink className="w-3 h-3" aria-label="(opens in new tab)" />
              </a>{" "}
              under Disability Services.
            </p>
          </section>

          <div className="pt-4 border-t border-border text-sm text-muted-foreground space-y-1">
            <p>This statement was last reviewed on <time dateTime="2026-07">July 2026</time>.</p>
            <p>
              <Link
                href="/"
                className="underline underline-offset-2 hover:opacity-80"
              >
                ← Return to BSU CAI Tools
              </Link>
            </p>
          </div>
        </div>
      </main>

      <PoweredByFooter />
    </div>
  );
}
