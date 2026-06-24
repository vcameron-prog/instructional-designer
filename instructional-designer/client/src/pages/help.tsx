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
import { 
  ArrowLeft, 
  BookOpen, 
  Sparkles, 
  FileText, 
  Calendar, 
  CheckCircle,
  Layout,
  Target,
  HelpCircle,
  Lightbulb,
  ExternalLink,
  Scale,
  GraduationCap,
  ShieldCheck,
  Link2,
  Library,
  Eye,
  Bot,
  FileCheck2,
  Upload,
  Search,
  Wand2,
  Download,
  ArrowRight
} from "lucide-react";

const tools = [
  {
    id: "syllabus",
    name: "Syllabus Editor",
    icon: BookOpen,
    description: "Creates a comprehensive syllabus following BSU guidelines with all required sections.",
    tips: [
      "Upload your existing syllabus to maintain consistency",
      "Include detailed learning outcomes for better results",
      "Review the policies section for accuracy",
    ],
    exampleOutput: "Course overview, learning outcomes, weekly schedule, grading breakdown, policies (attendance, academic integrity, accessibility), required materials, and instructor contact information.",
  },
  {
    id: "schedule",
    name: "Course Schedule Designer",
    icon: Calendar,
    description: "Generates a week-by-week schedule aligned with BSU's academic calendar.",
    tips: [
      "The tool automatically includes BSU holidays and breaks",
      "Specify key topics and assessments you want included",
      "Review dates against your department's specific requirements",
    ],
    exampleOutput: "Week-by-week breakdown with topics, readings, activities, and due dates. Includes BSU holidays, spring/fall breaks, and exam periods.",
  },
  {
    id: "assignment",
    name: "Assignment Design",
    icon: FileText,
    description: "Creates detailed assignment instructions with optional inclusive design frameworks.",
    tips: [
      "Be specific about learning objectives",
      "Choose which frameworks to include: UDL, Cultural Relevance, SEL, Accessibility, and/or AI-Powered Student Activities",
      "Only selected frameworks will be incorporated into the output",
      "Include any constraints (word count, format requirements)",
    ],
    exampleOutput: "Assignment overview, learning objectives, detailed instructions, submission requirements, grading criteria, and optional inclusive design guidance based on selected frameworks.",
  },
  {
    id: "module",
    name: "Module Design",
    icon: Layout,
    description: "Structures learning modules with activities, resources, and assessments.",
    tips: [
      "Define clear module objectives",
      "Specify the estimated time for completion",
      "Consider varied activity types for engagement",
    ],
    exampleOutput: "Module overview, learning objectives, content sections with readings/videos, learning activities, discussion prompts, and assessment aligned with module goals.",
  },
  {
    id: "rubric",
    name: "Rubric Builder",
    icon: CheckCircle,
    description: "Creates detailed assessment rubrics with clear criteria and levels.",
    tips: [
      "List specific criteria you want assessed",
      "Choose appropriate point values",
      "Review descriptors for clarity and measurability",
    ],
    exampleOutput: "Evaluation criteria with performance levels (e.g., Excellent, Good, Developing, Beginning), point values, and specific behavioral descriptors for each level.",
  },
  {
    id: "grading",
    name: "Grading Policy Designer",
    icon: Scale,
    description: "Creates equitable grading policies based on Grading for Equity principles.",
    tips: [
      "Focus on measuring content knowledge, not compliance",
      "Consider revision opportunities and late work flexibility",
      "Review traditional participation/attendance requirements",
    ],
    exampleOutput: "Grading scale, assignment categories with weights, late work policy, revision/reassessment opportunities, and policies that focus on learning over compliance.",
  },
  {
    id: "aipolicy",
    name: "AI Policy Generator",
    icon: Sparkles,
    description: "Creates a clear AI use policy for your course.",
    tips: [
      "Consider your discipline's norms around AI",
      "Be specific about what constitutes acceptable use",
      "Include consequences and detection methods if relevant",
    ],
    exampleOutput: "Policy statement, permitted vs. prohibited uses, citation/disclosure requirements, examples by assignment type, and guidance on maintaining academic integrity.",
  },
  {
    id: "alignment",
    name: "Alignment Checker",
    icon: Target,
    description: "Analyzes alignment between outcomes, activities, and assessments.",
    tips: [
      "Include all course components for comprehensive analysis",
      "Review gaps identified in the alignment",
      "Use suggestions to strengthen course design",
    ],
    exampleOutput: "Alignment matrix showing connections between learning outcomes, activities, and assessments. Identifies gaps and provides recommendations for strengthening alignment.",
  },
  {
    id: "airesistant",
    name: "AI-Resistant Assignment Designer",
    icon: ShieldCheck,
    description: "Analyzes assignments for AI vulnerability and provides strategies to make them more authentic.",
    tips: [
      "Paste your complete existing assignment for best analysis",
      "Consider which enhancement strategies fit your course context",
      "Use the revised assignment as a starting point, then customize",
      "Focus on authentic assessment rather than just detection",
    ],
    exampleOutput: "Vulnerability analysis, enhancement strategies (personal connection, process documentation, real-time components), and a revised assignment with AI-resistant features.",
  },
  {
    id: "accessibility",
    name: "Accessibility Checker",
    icon: Eye,
    description: "Analyzes course content for accessibility compliance and provides improvement recommendations.",
    tips: [
      "Paste assignment instructions, syllabus sections, or any course content",
      "Select which areas to analyze: visual, cognitive, motor, auditory, language",
      "Choose student populations to consider for targeted recommendations",
      "Use suggestions to improve content before sharing with students",
    ],
    exampleOutput: "Overall accessibility rating, barrier identification by category, specific recommendations with high/medium/low priority, revised content samples, and an accessible design checklist.",
  },
  {
    id: "aistudent",
    name: "AI-Powered Activity Designer",
    icon: Bot,
    description: "Designs student activities where AI is intentionally used as a learning tool, grounded in evidence-based AI pedagogy.",
    tips: [
      "Choose an activity type that matches your learning goals (debate, drafting, research, etc.)",
      "Select the appropriate student AI experience level for scaffolded instructions",
      "Pick critical thinking focus areas to develop specific analytical skills",
      "Add guardrails like reflection requirements or AI interaction logs to ensure meaningful engagement",
    ],
    exampleOutput: "Activity overview with AI literacy objectives, step-by-step student instructions with sample AI prompts, critical thinking checkpoints, reflection component, submission requirements with AI documentation, grading considerations, and ethical guidelines.",
  },
];

const faqs = [
  {
    question: "How do I get started?",
    answer: "Click 'Design a New Course' on the home page and enter your course information. The more detail you provide (especially learning outcomes and any existing syllabus), the better the generated content will be.",
  },
  {
    question: "Is my work saved automatically?",
    answer: "Yes! Your courses and all generated content are saved automatically to the database. You can close the browser and return later - everything will still be there.",
  },
  {
    question: "Can I edit the generated content?",
    answer: "Absolutely! You can copy the content and edit it in any word processor, or use the 'Refine' feature to ask the AI to make specific changes. Each refinement is saved as a new version.",
  },
  {
    question: "What is Universal Design for Learning (UDL)?",
    answer: "UDL is a framework for designing instruction that meets the needs of all learners. It emphasizes multiple means of engagement (the 'why'), representation (the 'what'), and action/expression (the 'how'). All generated content incorporates these principles.",
  },
  {
    question: "How do I use this content in Blackboard Ultra?",
    answer: "Download the content using the Word (.docx) option for formatted documents. You can then upload to Blackboard or copy-paste into content areas. Rubrics can be imported using Blackboard's rubric import feature.",
  },
  {
    question: "Can I reuse content across courses?",
    answer: "Yes! Use the 'Save as Template' button to save content to your Content Library for use across any course. You can also duplicate a course to use it as a starting point for a new course.",
  },
  {
    question: "What if I don't like the generated content?",
    answer: "Use the 'Refine' feature to request specific changes. You can ask for a different tone, more detail, different examples, or any other modifications. Each version is saved so you can compare.",
  },
  {
    question: "Is my data private?",
    answer: (<>Your course information and generated content are stored securely and are not shared with other users. Content generation uses Anthropic's Claude API — see <a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">Anthropic's privacy policy</a> for details on data handling.</>),
  },
  {
    question: "What file types does the document converter support?",
    answer: "The Accessibility Converter accepts PDF files (.pdf), Word documents (.docx), Excel spreadsheets (.xlsx), and PowerPoint presentations (.pptx) up to 20MB. You can also import Google Docs, Google Sheets, or Google Slides by pasting the document link (the document must be shared with \"Anyone with the link\"). Text-based PDFs, scanned documents (OCR is applied automatically), and documents with images, tables, and mixed content are all supported. The converter outputs accessible HTML or Word (.docx) documents.",
  },
  {
    question: "What accessibility standards does the PDF converter check for?",
    answer: "The converter checks against WCAG 2.1 Level AA success criteria, which is the standard required for ADA Title II compliance. This includes checks for proper heading structure, image alt text, reading order, color contrast, table headers, language attributes, document structure, and landmark regions. Both automated and AI-powered audits are performed to ensure comprehensive coverage.",
  },
  {
    question: "How long does PDF conversion take?",
    answer: "Most documents are processed within 1-2 minutes. Larger documents with many pages, complex tables, or numerous images may take longer. The converter uses AI to analyze content, generate alt text for images, restructure tables, and build proper document hierarchy — all of which contribute to a thorough remediation.",
  },
  {
    question: "How was this tool built?",
    answer: "This tool was developed through experimentation with Replit's vibe-coding platform, which makes it possible to build and deploy a full web application through a conversational AI interface — no traditional development environment required. It's been an interesting way to explore what's possible with AI-assisted development in a higher education context.",
  },
];

const udlPrinciples = [
  {
    title: "Multiple Means of Engagement",
    description: "Provide options for self-regulation, sustaining effort, and recruiting interest.",
    examples: ["Varied assignment types", "Choice in topics", "Collaborative options", "Real-world connections"],
  },
  {
    title: "Multiple Means of Representation",
    description: "Provide options for perception, language, and comprehension.",
    examples: ["Text, audio, and visual content", "Clear vocabulary definitions", "Highlight key concepts", "Provide examples"],
  },
  {
    title: "Multiple Means of Action & Expression",
    description: "Provide options for physical action, expression, and executive function.",
    examples: ["Varied submission formats", "Scaffolded assignments", "Templates and outlines", "Practice opportunities"],
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
                  <p className="text-sm text-muted-foreground">Learn how to use the Accessibility Tool</p>
                </div>
              </div>
            </div>
            <HeaderControls variant="light" showHelp={false} />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <section className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-primary" />
              Design Tools
            </h2>
            <Button
              variant="outline"
              onClick={() => navigate("/research")}
              data-testid="link-research"
            >
              <GraduationCap className="w-4 h-4 mr-2" />
              Research & Theory
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {tools.map((tool) => {
              const Icon = tool.icon;
              return (
                <Card key={tool.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <CardTitle className="text-lg">{tool.name}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="mb-3">{tool.description}</CardDescription>
                    <div className="text-sm mb-3">
                      <span className="font-medium">Tips:</span>
                      <ul className="mt-1 space-y-1 text-muted-foreground">
                        {tool.tips.map((tip, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-primary mt-1">•</span>
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="text-sm pt-3 border-t">
                      <span className="font-medium">Example output:</span>
                      <p className="mt-1 text-muted-foreground">{tool.exampleOutput}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <Lightbulb className="w-6 h-6 text-primary" />
            UDL Principles in Practice
          </h2>
          <Card>
            <CardContent className="pt-6">
              <p className="mb-6 text-muted-foreground">
                All content generated by this tool incorporates UDL principles to ensure your course materials 
                are accessible and effective for all learners.
              </p>
              <div className="grid gap-6 md:grid-cols-3">
                {udlPrinciples.map((principle) => (
                  <div key={principle.title} className="space-y-2">
                    <h3 className="font-semibold text-primary">{principle.title}</h3>
                    <p className="text-sm text-muted-foreground">{principle.description}</p>
                    <ul className="text-sm space-y-1">
                      {principle.examples.map((example, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <CheckCircle className="w-3 h-3 text-primary" />
                          {example}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-6 border-t">
                <a 
                  href="https://udlguidelines.cast.org/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                >
                  Learn more about UDL at CAST.org <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <Link2 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            Connected Course Materials
          </h2>
          <Card>
            <CardContent className="pt-6">
              <p className="mb-4 text-muted-foreground">
                Connected Course Materials is a powerful feature that allows you to link your approved content 
                together within a single course. When you mark content as "connected," it becomes available 
                to inform other tools when generating new materials.
              </p>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-600 dark:text-blue-400 font-semibold">1</span>
                  </div>
                  <div>
                    <h4 className="font-semibold">Generate Content</h4>
                    <p className="text-sm text-muted-foreground">Use any of the 11 design tools to create course materials like syllabi, assignments, or rubrics.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-600 dark:text-blue-400 font-semibold">2</span>
                  </div>
                  <div>
                    <h4 className="font-semibold">Connect to Course</h4>
                    <p className="text-sm text-muted-foreground">Click the "Connect to Course" button on content you've reviewed and approved. This marks it as part of your official course materials.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-600 dark:text-blue-400 font-semibold">3</span>
                  </div>
                  <div>
                    <h4 className="font-semibold">Inform Other Tools</h4>
                    <p className="text-sm text-muted-foreground">Connected materials are displayed on your tools page and will be used as context when generating new content, ensuring consistency across your course.</p>
                  </div>
                </div>
              </div>
              <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <p className="text-sm">
                  <strong>Example:</strong> If you connect your syllabus, then when you generate assignments, 
                  the AI will reference your syllabus learning objectives to ensure alignment.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <Library className="w-6 h-6 text-primary" />
            Content Library
          </h2>
          <Card>
            <CardContent className="pt-6">
              <p className="mb-4 text-muted-foreground">
                The Content Library allows you to save your best content as reusable templates 
                that can be applied to any course. Unlike Connected Course Materials (which are 
                course-specific), templates are available across all your courses.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="p-4 bg-muted/50 rounded-lg">
                  <h4 className="font-semibold mb-2">Saving Templates</h4>
                  <ul className="text-sm text-muted-foreground space-y-2">
                    <li className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      Click "Save as Template" on any generated content
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      Give it a descriptive title for easy finding
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      Add optional notes about when to use it
                    </li>
                  </ul>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg">
                  <h4 className="font-semibold mb-2">Using Templates</h4>
                  <ul className="text-sm text-muted-foreground space-y-2">
                    <li className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      Access templates from the Content Library button
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      Copy content to use in any course
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      Download as text file for offline use
                    </li>
                  </ul>
                </div>
              </div>
              <div className="mt-6 p-4 bg-primary/5 rounded-lg border border-primary/10">
                <p className="text-sm">
                  <strong>Tip:</strong> Save your best AI policies, rubric frameworks, and module structures 
                  as templates. This way you can quickly apply consistent formats across all your courses.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <FileCheck2 className="w-6 h-6 text-primary" />
            Accessibility Converter
          </h2>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <FileCheck2 className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-1">Convert Documents to Accessible Formats</h3>
                  <p className="text-muted-foreground">
                    The Accessibility Converter transforms PDF files, Word documents (.docx), and Google Docs into WCAG 2.1 AA compliant 
                    accessible formats. Using AI-powered remediation, it analyzes your document's structure, images, 
                    and tables to produce properly structured HTML or Word documents that work with screen readers 
                    and other assistive technologies.
                  </p>
                </div>
              </div>

              <div className="p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800 mb-6">
                <h4 className="font-semibold text-amber-800 dark:text-amber-300 mb-1">Why Accessible PDFs Matter</h4>
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  Under ADA Title II, state and local government entities — including public universities — are required 
                  to ensure their digital content is accessible to people with disabilities. WCAG 2.1 Level AA is the 
                  recognized standard for meeting this obligation. Inaccessible PDFs can prevent students using screen 
                  readers, magnification software, or other assistive technologies from accessing course materials.
                </p>
              </div>

              <div className="mb-6">
                <h4 className="font-semibold mb-3">What WCAG 2.1 AA Compliance Means</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  WCAG (Web Content Accessibility Guidelines) 2.1 Level AA is a set of success criteria that ensure 
                  digital content is perceivable, operable, understandable, and robust for all users. The converter 
                  checks and addresses the following key criteria:
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-sm font-medium">Proper Heading Structure</span>
                      <p className="text-xs text-muted-foreground">Logical heading hierarchy (H1–H6) for navigation</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-sm font-medium">Image Alt Text</span>
                      <p className="text-xs text-muted-foreground">Meaningful descriptions for all images</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-sm font-medium">Color Contrast</span>
                      <p className="text-xs text-muted-foreground">Sufficient contrast ratios for text readability</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-sm font-medium">Reading Order</span>
                      <p className="text-xs text-muted-foreground">Logical content sequence for screen readers</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-sm font-medium">Accessible Tables</span>
                      <p className="text-xs text-muted-foreground">Proper headers, captions, and scope attributes</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-sm font-medium">Language Attributes</span>
                      <p className="text-xs text-muted-foreground">Document language declared for correct pronunciation</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-sm font-medium">Document Structure</span>
                      <p className="text-xs text-muted-foreground">Semantic HTML with landmarks and regions</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-sm font-medium">Page Title</span>
                      <p className="text-xs text-muted-foreground">Descriptive title for document identification</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mb-6">
                <h4 className="font-semibold mb-3">How It Works</h4>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Upload className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h5 className="font-medium text-sm">1. Upload Your Document</h5>
                      <p className="text-xs text-muted-foreground">Drag and drop or browse to upload a PDF, Word (.docx), Excel (.xlsx), or PowerPoint (.pptx) file (up to 20MB). You can also paste a Google Docs, Google Sheets, or Google Slides link (shared with "Anyone with the link"). Scanned PDFs are supported via automatic OCR.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Wand2 className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h5 className="font-medium text-sm">2. AI-Powered Remediation</h5>
                      <p className="text-xs text-muted-foreground">The AI analyzes your document's layout, extracts text and images, generates alt text, restructures tables, and builds a proper heading hierarchy.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Search className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h5 className="font-medium text-sm">3. Compliance Audit</h5>
                      <p className="text-xs text-muted-foreground">Both automated and AI-powered audits check the output against WCAG 2.1 AA criteria, producing a detailed compliance report with a score.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <ShieldCheck className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h5 className="font-medium text-sm">4. Interactive Issue Fixing</h5>
                      <p className="text-xs text-muted-foreground">Review flagged issues and use the one-click AI fix to resolve them, or accept limitations with a justification for your records.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Download className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h5 className="font-medium text-sm">5. Download Accessible Document</h5>
                      <p className="text-xs text-muted-foreground">Download your accessible document as a Word (.docx) file or HTML. You can also copy the HTML directly for use in Blackboard or other platforms.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mb-6">
                <h4 className="font-semibold mb-3">Tips for Best Results</h4>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Lightbulb className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    Word documents (.docx) and text-based PDFs produce the best results — scanned PDFs work too via OCR
                  </li>
                  <li className="flex items-start gap-2">
                    <Lightbulb className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    Keep documents under 20 pages for fastest processing
                  </li>
                  <li className="flex items-start gap-2">
                    <Lightbulb className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    Review the compliance report carefully and address any flagged issues before distributing
                  </li>
                  <li className="flex items-start gap-2">
                    <Lightbulb className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    Use the Word (.docx) download for Blackboard uploads — it preserves formatting best
                  </li>
                  <li className="flex items-start gap-2">
                    <Lightbulb className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    Always double-check AI-generated alt text for accuracy, especially for charts and diagrams
                  </li>
                </ul>
              </div>

              <div className="pt-4 border-t">
                <Button
                  onClick={() => window.open(import.meta.env.VITE_CONVERTER_APP_URL || "#", "_blank", "noopener noreferrer")}
                  className="w-full sm:w-auto"
                  data-testid="button-go-to-pdf-converter"
                >
                  <FileCheck2 className="w-4 h-4 mr-2" />
                  Go to Accessibility Converter
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <ExternalLink className="w-6 h-6 text-primary" />
            Additional Resources
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <a
              href="https://anthropic.skilljar.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="block group"
              data-testid="link-skilljar"
            >
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <GraduationCap className="w-5 h-5 text-primary" />
                    </div>
                    <CardTitle className="text-lg group-hover:text-primary transition-colors">
                      Anthropic Learning Center
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="mb-3">
                    Educational courses and training materials for Claude and Anthropic AI tools. 
                    This learning platform provides interactive learning experiences, tracks your progress, 
                    and helps you build skills for using AI effectively in your teaching practice.
                  </CardDescription>
                  <span className="text-sm text-primary inline-flex items-center gap-1 group-hover:underline">
                    Visit anthropic.skilljar.com <ExternalLink className="w-3 h-3" />
                  </span>
                </CardContent>
              </Card>
            </a>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <HelpCircle className="w-6 h-6 text-primary" />
            Frequently Asked Questions
          </h2>
          <Card>
            <CardContent className="pt-6">
              <Accordion type="single" collapsible className="w-full">
                {faqs.map((faq, index) => (
                  <AccordionItem key={index} value={`item-${index}`}>
                    <AccordionTrigger className="text-left">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        </section>
      </div>
      <PoweredByFooter />
    </main>
  );
}
