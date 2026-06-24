import { useLocation } from "wouter";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { HeaderControls } from "@/components/header-controls";
import { SIGN_IN_REQUIREMENT_TEXT } from "@/lib/sign-in-requirement";
import {
  FILE_SIZE_FAQ_ANSWER,
  HOW_BUILT_ANSWER,
  PRIVACY_ANSWER,
  SUPPORTED_FORMATS,
} from "@/lib/faq-shared";
import {
  ArrowLeft,
  HelpCircle,
  Upload,
  FileText,
  Download,
  CheckCircle,
  AlertTriangle,
  Clock,
  Eye,
  FileCheck2,
  ExternalLink,
} from "lucide-react";

const steps = [
  {
    icon: Upload,
    title: "Upload your document",
    description: "Drag and drop or browse to select a PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), or other supported file. You can also paste a Google Docs, Sheets, or Slides URL.",
  },
  {
    icon: Eye,
    title: "Automated accessibility audit",
    description: "The tool extracts text, checks reading order, analyzes headings, tables, images, and color contrast against WCAG 2.1 AA — the standard required for ADA Title II compliance.",
  },
  {
    icon: FileCheck2,
    title: "Review the compliance report",
    description: "See a full list of issues found, with severity levels and suggested fixes. You can apply AI-suggested fixes automatically or make manual edits in the built-in editor.",
  },
  {
    icon: Download,
    title: "Download the accessible version",
    description: "Export the remediated document as accessible HTML, a Word (.docx) file, or a tagged PDF suitable for screen readers and assistive technologies.",
  },
];

const formats = SUPPORTED_FORMATS;

const faqs = [
  {
    question: "What file size limit applies?",
    answer: FILE_SIZE_FAQ_ANSWER,
  },
  {
    question: "What accessibility standard does the converter check against?",
    answer: "The converter checks against WCAG 2.1 Level AA, which is the standard required for ADA Title II compliance. Checks include proper heading structure, image alt text, reading order, color contrast, table headers, language attributes, and landmark regions.",
  },
  {
    question: "How long does conversion take?",
    answer: "Most documents are processed within 1–2 minutes. Large documents with many pages, complex tables, or numerous images may take slightly longer. The page updates automatically when processing is complete.",
  },
  {
    question: "What is OCR and when is it used?",
    answer: "OCR (Optical Character Recognition) extracts text from scanned documents or image-based PDFs where the text is not directly readable. It is applied automatically when the tool detects that a PDF has no extractable text layer.",
  },
  {
    question: "Can I edit the converted document before downloading?",
    answer: "Yes. The built-in editor lets you view and edit the accessible HTML directly. You can fix headings, update alt text, edit table captions, and more before exporting.",
  },
  {
    question: "Do I need an account?",
    answer: SIGN_IN_REQUIREMENT_TEXT,
  },
  {
    question: "Is my document stored securely?",
    answer: PRIVACY_ANSWER,
  },
  {
    question: "What download formats are available?",
    answer: "You can download the remediated document as: (1) Accessible HTML — a clean, screen-reader-friendly web page; (2) Word (.docx) — for editing in Microsoft Word or uploading to an LMS like Blackboard Ultra; (3) Tagged PDF — a PDF with proper accessibility tags.",
  },
  {
    question: "How was this tool built?",
    answer: HOW_BUILT_ANSWER,
  },
];

export default function HelpPage() {
  const [, navigate] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const fromPath = searchParams.get("from");

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handleBack = () => {
    navigate(fromPath || "/");
  };

  usePageTitle("Help & Resources");

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleBack}
                aria-label="Go back"
                data-testid="button-back"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <HelpCircle className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">Help & Resources</h1>
                  <p className="text-sm text-muted-foreground">How to use the Accessibility Converter</p>
                </div>
              </div>
            </div>
            <HeaderControls variant="light" showHelp={false} />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-4xl">

        {/* How it works */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <CheckCircle className="w-6 h-6 text-primary" />
            How It Works
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {steps.map((step, i) => {
              const Icon = step.icon;
              return (
                <Card key={i}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <CardTitle className="text-base">{i + 1}. {step.title}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription>{step.description}</CardDescription>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Supported formats */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary" />
            Supported File Formats
          </h2>
          <Card>
            <CardContent className="pt-6">
              <div className="grid gap-3 sm:grid-cols-2">
                {formats.map((f) => (
                  <div key={f.name} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-sm">{f.name}</p>
                      <p className="text-xs text-muted-foreground">{f.notes}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  Maximum file size: <strong>20 MB</strong>. Password-protected documents cannot be processed.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Processing time */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <Clock className="w-6 h-6 text-primary" />
            What to Expect
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <p className="text-2xl font-bold text-primary">1–2 min</p>
                  <p className="text-sm text-muted-foreground mt-1">Typical processing time</p>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <p className="text-2xl font-bold text-primary">WCAG 2.1 AA</p>
                  <p className="text-sm text-muted-foreground mt-1">Accessibility standard checked</p>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <p className="text-2xl font-bold text-primary">3 formats</p>
                  <p className="text-sm text-muted-foreground mt-1">HTML · DOCX · Tagged PDF</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                The converter performs both automated rule-based checks and AI-powered analysis to catch
                issues that automated tools alone may miss — such as ambiguous alt text, complex table
                structures, and reading-order problems in multi-column layouts.
              </p>
              <div className="pt-2">
                <a
                  href="https://www.w3.org/WAI/WCAG21/quickref/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                >
                  WCAG 2.1 Quick Reference at W3C <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* FAQs */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <HelpCircle className="w-6 h-6 text-primary" />
            Frequently Asked Questions
          </h2>
          <Accordion type="single" collapsible className="space-y-2">
            {faqs.map((faq, i) => (
              <AccordionItem key={i} value={`faq-${i}`} className="border rounded-lg px-4">
                <AccordionTrigger className="text-left font-medium hover:no-underline">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

      </div>

      <PoweredByFooter />
    </main>
  );
}
