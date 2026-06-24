import { useState, useEffect, isValidElement } from "react";
import React from "react";
import { useLocation } from "wouter";
import caiLogoWhite from "@assets/bsu-cai-logo.png";
import {
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  FileText,
  HelpCircle,
} from "lucide-react";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { SIGN_IN_REQUIREMENT_LINES } from "@/lib/sign-in-requirement";
import {
  FILE_SIZE_FAQ_ANSWER,
  HOW_BUILT_ANSWER,
  PRIVACY_ANSWER,
  SUPPORTED_FORMATS_LINES,
} from "@/lib/faq-shared";

interface FAQItem {
  question: string;
  answer: string | string[] | React.ReactNode;
}

interface FAQSection {
  title: string;
  items: FAQItem[];
}

const FAQ_SECTIONS: FAQSection[] = [
  {
    title: "Getting Started",
    items: [
      {
        question: "What does this tool do?",
        answer:
          "This tool converts PDF, Word (.docx), and Google Docs documents into more accessible HTML files, applying the structural and descriptive features that ADA Title II and WCAG 2.1 Level AA call for. It uses AI to analyze your document's structure and add proper headings, image descriptions, reading order, and other accessibility features.",
      },
      {
        question: "Who is this tool for?",
        answer:
          "This tool is designed for anyone who needs to make documents accessible to people with disabilities, including those who use screen readers or other assistive technologies. It is particularly useful for educators, administrators, and content creators who publish materials online.",
      },
      {
        question: "Do I need to sign in?",
        answer: SIGN_IN_REQUIREMENT_LINES,
      },
      {
        question: "Do I need any technical skills to use this?",
        answer:
          "No. Simply drag and drop your file, and the tool handles the rest. You'll get a downloadable Word document or HTML file that's ready to share with students.",
      },
      {
        question: "How was this tool built?",
        answer: HOW_BUILT_ANSWER,
      },
      {
        question: "What file types can I upload?",
        answer: SUPPORTED_FORMATS_LINES,
      },
      {
        question: "What file size limit applies?",
        answer: FILE_SIZE_FAQ_ANSWER,
      },
    ],
  },
  {
    title: "Google Workspace Imports",
    items: [
      {
        question: "Which Google file types can I import?",
        answer: [
          "You can import any of the following Google Workspace file types:",
          "• Google Docs — word-processed documents",
          "• Google Sheets — spreadsheets",
          "• Google Slides — presentations",
          "Each type has its own import section on the Accessibility Converter page. All three require the file to be publicly shared before importing.",
        ],
      },
      {
        question: "How do I convert a Google Doc?",
        answer: [
          "1. Go to the Accessibility Converter page.",
          '2. In the "Import from Google Docs" section, paste the link to your Google Doc.',
          "3. Click the Download button — this saves the document as a Word file to your computer.",
          "4. Drag and drop the downloaded Word file into the upload area at the top of the page.",
          "The tool will then convert it to an accessible format just like any other document.",
        ],
      },
      {
        question: "How do I convert a Google Sheet or Google Slides presentation?",
        answer: [
          "Google Sheets and Google Slides support direct import — no download step needed.",
          "1. Go to the Accessibility Converter page.",
          '2. Find the "Import from Google Sheets" or "Import from Google Slides" section.',
          "3. Paste the link to your file and click Import.",
          "The tool processes the file directly and takes you to the conversion results.",
        ],
      },
      {
        question: "Do Google Docs, Sheets, and Slides need to be shared?",
        answer:
          'Yes. All three file types must be shared as "Anyone with the link" before importing. You can change this in the file\'s sharing settings (click Share → change access to "Anyone with the link"). Without this setting, the import will fail.',
      },
      {
        question: "Why does importing a Google Doc require a download step?",
        answer:
          "Google restricts automated downloads of Docs from cloud servers. The Download button opens the file directly from Google through your browser, which works reliably. After downloading, you upload the resulting Word file. Google Sheets and Slides use a different Google API that allows direct server-side import, so those file types do not require this extra step.",
      },
    ],
  },
  {
    title: "Accessibility & Compliance",
    items: [
      {
        question: "What is ADA Title II compliance?",
        answer:
          "ADA Title II requires that state and local government entities, including public universities, make their services and programs accessible to people with disabilities. This includes digital documents shared with students.",
      },
      {
        question: "What is WCAG 2.1 Level AA?",
        answer:
          "WCAG (Web Content Accessibility Guidelines) is a set of standards for making web content accessible. Level AA is the standard most organizations are expected to meet. It covers things like text alternatives for images, proper document structure, readable text, and keyboard navigation.",
      },
      {
        question: "What does the compliance score mean?",
        answer: [
          "The compliance score shows how well your converted document meets accessibility standards. It checks for:",
          "• Image Descriptions — Do all images have meaningful descriptions?",
          "• Document Structure — Are headings, lists, and sections properly organized?",
          "• Reading Order — Does the content flow logically for screen readers?",
          "• Table Headers — Do data tables have proper header labels?",
          "• Text Alternatives — Are all non-text elements described?",
          'A score of 100% means the document passes all checks. If the score is lower, you can use the "Fix with AI" button on individual issues to improve it.',
        ],
      },
    ],
  },
  {
    title: "Using Your Accessible File",
    items: [
      {
        question: "How do I upload the file to Blackboard?",
        answer: [
          "Method 1: Upload Word Document (Recommended)",
          '1. Click the green "Download Word (.docx)" button to save the file.',
          "2. Log in to Blackboard and open your course.",
          "3. In Course Content, click the + button.",
          "4. Click Upload and upload the .docx file.",
          "5. Click Save and make the file visible to students.",
          "",
          "Method 2: Paste HTML Inline (Alternative)",
          '1. Click the blue "Copy HTML" button to copy the accessible content.',
          "2. In Blackboard, create a new Document and switch to HTML view.",
          "3. Paste the HTML and save.",
        ],
      },
      {
        question: "Can I share the file by email?",
        answer:
          "Yes. You can attach the Word (.docx) file or the HTML file to an email. The Word file opens in Microsoft Word or Google Docs, and the HTML file opens in any web browser.",
      },
      {
        question: "Will the accessible file work on phones and tablets?",
        answer:
          "Yes. Both the Word (.docx) and HTML files are designed to work on any device.",
      },
    ],
  },
  {
    title: "Fixing Issues",
    items: [
      {
        question: "How does 'Fix with AI' work?",
        answer:
          'When the compliance report shows an issue, you can click the "Fix with AI" button next to it. The AI will analyze the specific problem and update the HTML to fix it. The compliance score updates automatically after the fix.',
      },
      {
        question: "Can the AI fix everything?",
        answer:
          "The AI can fix most common accessibility issues, like missing image descriptions, improper heading levels, and missing table headers. Some complex issues may require manual review.",
      },
      {
        question: "How does the remediation process work?",
        answer:
          "When you upload a document, the app sends it to an AI service (Anthropic's Claude) that has been given detailed instructions based on accessibility best practices. The AI scans the file for common barriers — things like missing image descriptions (alt text), unlabeled or out-of-order headings, tables without proper headers, and untagged content that screen readers depend on. It then rewrites or restructures those elements so assistive technology can interpret the document more easily, and returns a new version of your file with those improvements applied. The guidance the AI follows is built around the Web Content Accessibility Guidelines (WCAG) 2.1, the standard most institutions use to measure digital accessibility.",
      },
      {
        question: "What this tool can and can't do",
        answer: [
          "This tool is designed to improve the accessibility of your documents, not to certify compliance. It applies automated remediation aimed at meeting WCAG 2.1 standards, and in most cases it will meaningfully improve a file's accessibility.",
          "However, automated tools — including this one — cannot guarantee that a document is fully accessible or fully WCAG 2.1 compliant. Only a human reviewer can confirm that a document is genuinely usable by people with disabilities.",
          "We strongly recommend that you review remediated files, test them with assistive technology where possible, and treat the output as a draft rather than a final sign-off. Each institution remains responsible for verifying the accessibility of its own content.",
        ],
      },
    ],
  },
  {
    title: "Privacy & Data",
    items: [
      {
        question: "Is my document data secure?",
        answer: PRIVACY_ANSWER,
      },
      {
        question: "Who can see my uploaded documents?",
        answer: [
          "It depends on whether you're signed in:",
          "• Signed in — Only you can see your uploaded documents and conversion history. Each user's data is private.",
          "• Not signed in — Your conversions are processed but not saved to any account. Once you leave the page, the conversion is no longer accessible.",
        ],
      },
    ],
  },
];

function FAQAccordionItem({ item, index }: { item: FAQItem; index: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const isNode = isValidElement(item.answer);
  const content = isNode ? [] : (Array.isArray(item.answer) ? item.answer as string[] : [item.answer as string]);
  const panelId = `faq-panel-${index}`;
  const buttonId = `faq-button-${index}`;

  return (
    <div className="border rounded-xl overflow-hidden">
      <button
        id={buttonId}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-secondary/50 transition-colors"
        aria-expanded={isOpen}
        aria-controls={panelId}
        data-testid={`faq-question-${index}`}
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
        <span
          className={cn(
            "text-sm font-semibold",
            isOpen ? "text-blue-600 dark:text-blue-400" : "text-foreground",
          )}
        >
          {item.question}
        </span>
      </button>
      {isOpen && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          className="px-4 pb-4 pl-11"
        >
          <div className="text-sm text-muted-foreground space-y-2">
            {isNode ? (
              <p>{item.answer as React.ReactNode}</p>
            ) : (
              content.map((line, i) => (
                <p
                  key={i}
                  className={cn(
                    line.startsWith("•") ? "ml-2" : "",
                    /^\d+\./.test(line) ? "ml-2" : "",
                  )}
                >
                  {line}
                </p>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PdfFaq() {
  usePageTitle("Accessibility Converter FAQ");
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const [, navigate] = useLocation();

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen bg-background"
    >
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              aria-label="Home — CAI Tools"
              data-testid="button-home-logo"
              className="flex-shrink-0"
            >
              <img
                src={caiLogoWhite}
                alt="Center for Artificial Intelligence"
                className="h-8 w-auto"
              />
            </button>
            <div className="w-px h-6 bg-border" aria-hidden="true" />
            <button
              onClick={() => navigate("/pdf-accessibility")}
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-back"
              aria-label="Back to Accessibility Converter"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1
                className="font-bold text-foreground text-lg"
                data-testid="text-page-title"
              >
                Frequently Asked Questions
              </h1>
              <p className="text-xs text-muted-foreground">
                Accessibility Converter
              </p>
            </div>
          </div>
          <HeaderControls
           
            showLibrary={false}
            showHelp={false}
          />
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="space-y-8">
          {FAQ_SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="text-lg font-bold text-foreground mb-3">
                {section.title}
              </h2>
              <div className="space-y-2">
                {section.items.map((item, idx) => (
                  <FAQAccordionItem
                    key={item.question}
                    item={item}
                    index={FAQ_SECTIONS.indexOf(section) * 100 + idx}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-10 p-6 bg-secondary/50 border rounded-2xl text-center">
          <h2 className="font-bold text-foreground mb-2">
            Still have questions?
          </h2>
          <p className="text-sm text-muted-foreground">
            Contact the <strong>Center for Artificial Intelligence</strong> at{" "}
            <a
              href="mailto:CAI@bridgew.edu"
              className="underline text-primary hover:text-primary/80 font-medium"
            >
              CAI@bridgew.edu
            </a>
            .
          </p>
        </div>
      </div>
      <PoweredByFooter />
    </main>
  );
}
