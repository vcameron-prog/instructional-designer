import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, Eye, Image, Calculator, FileText, ArrowRight, Shield } from "lucide-react";
import { HeaderControls, BackButton } from "@/components/header-controls";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { usePageTitle } from "@/hooks/use-page-title";

function getConverterUrl(): string {
  if (import.meta.env.DEV) {
    return `${window.location.protocol}//${window.location.hostname}/accessibility`;
  }
  return import.meta.env.VITE_CONVERTER_APP_URL || `${window.location.protocol}//${window.location.hostname}/accessibility`;
}

const TOOLS = [
  {
    id: "document-converter",
    label: "Document Converter",
    description:
      "Convert PDFs, Word documents, PowerPoint, Excel, and Google Docs into WCAG 2.1 AA compliant accessible documents.",
    icon: <FileText className="w-6 h-6 text-white" aria-hidden="true" />,
    gradient: "from-blue-500 to-indigo-600",
    href: null,
    route: null,
    external: true,
    badge: "Open to everyone",
    testid: "card-tool-document-converter",
  },
  {
    id: "url-scanner",
    label: "URL Scanner",
    description:
      "Check any public webpage for accessibility issues and WCAG 2.1 violations using AI-powered analysis.",
    icon: <Globe className="w-6 h-6 text-white" aria-hidden="true" />,
    gradient: "from-sky-500 to-cyan-600",
    route: "/accessibility-tools/url-scanner",
    external: false,
    badge: "Open to everyone",
    testid: "card-tool-url-scanner",
  },
  {
    id: "color-contrast",
    label: "Color Contrast",
    description:
      "Verify foreground/background color combinations meet WCAG 2.1 contrast ratios for AA and AAA compliance.",
    icon: <Eye className="w-6 h-6 text-white" aria-hidden="true" />,
    gradient: "from-amber-500 to-orange-600",
    route: "/accessibility-tools/color-contrast",
    external: false,
    badge: "Open to everyone",
    testid: "card-tool-color-contrast",
  },
  {
    id: "alt-text",
    label: "Alt Text Generator",
    description:
      "Upload an image and get AI-generated alternative text descriptions following WCAG 2.1 guidelines.",
    icon: <Image className="w-6 h-6 text-white" aria-hidden="true" />,
    gradient: "from-fuchsia-500 to-pink-600",
    route: "/accessibility-tools/alt-text",
    external: false,
    badge: "Open to everyone",
    testid: "card-tool-alt-text",
  },
  {
    id: "math-ocr",
    label: "Math OCR",
    description:
      "Extract mathematical expressions from images and convert them into accessible plain text, LaTeX, and MathML.",
    icon: <Calculator className="w-6 h-6 text-white" aria-hidden="true" />,
    gradient: "from-rose-500 to-red-600",
    route: "/accessibility-tools/math-ocr",
    external: false,
    badge: "Open to everyone",
    testid: "card-tool-math-ocr",
  },
];

export default function AccessibilityToolsPage() {
  usePageTitle(
    "Accessibility Tools",
    "Built-in accessibility tools for BSU faculty: check color contrast, generate alt text, scan web pages for WCAG issues, and extract math equations from images.",
  );
  const [, navigate] = useLocation();
  const converterUrl = getConverterUrl();

  function openTool(tool: typeof TOOLS[0]) {
    if (tool.external) {
      window.open(converterUrl, "_blank", "noopener noreferrer");
    } else if (tool.route) {
      navigate(tool.route);
    }
  }

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">
      <nav aria-label="Back navigation" className="absolute top-4 left-4 z-20">
        <BackButton />
      </nav>
      <nav aria-label="User menu" className="absolute top-4 right-4 z-20">
        <HeaderControls showLogout={false} showLogin={false} />
      </nav>

      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-4">
            <Shield className="w-3.5 h-3.5" aria-hidden="true" />
            ADA Title II · WCAG 2.1 AA
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-3">
            Accessibility Tools
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            A suite of tools to help you create and verify accessible content for all learners.
            All tools are free to use — no login required.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {TOOLS.map((tool) => (
            <Card
              key={tool.id}
              className="group cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg border border-border"
              onClick={() => openTool(tool)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openTool(tool);
                }
              }}
              tabIndex={0}
              role="button"
              aria-label={tool.label}
              data-testid={tool.testid}
            >
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div
                    className={`w-12 h-12 rounded-xl bg-gradient-to-br ${tool.gradient} flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform`}
                  >
                    {tool.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-foreground">{tool.label}</p>
                      {tool.badge && (
                        <Badge variant="secondary" className="text-xs py-0">
                          {tool.badge}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {tool.description}
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center mt-10 max-w-md mx-auto">
          These tools improve accessibility but do not guarantee full WCAG 2.1 compliance.
          Always verify with a human reviewer and assistive technology testing.
        </p>
      </div>

      <PoweredByFooter />
    </main>
  );
}
