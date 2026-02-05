import { useLocation } from "wouter";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
  ShieldCheck
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
  },
  {
    id: "assignment",
    name: "Assignment Design",
    icon: FileText,
    description: "Creates detailed assignment instructions with UDL accommodations.",
    tips: [
      "Be specific about learning objectives",
      "Include any constraints (word count, format requirements)",
      "Review the UDL accommodations for appropriateness",
    ],
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
  },
];

const faqs = [
  {
    question: "How do I get started?",
    answer: "Click 'Start New Course' on the home page and enter your course information. The more detail you provide (especially learning outcomes and any existing syllabus), the better the generated content will be.",
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
    answer: "Yes! Use the 'Save to Library' feature to save content you want to reuse. You can also duplicate a course to use it as a starting point for a new course.",
  },
  {
    question: "What if I don't like the generated content?",
    answer: "Use the 'Refine' feature to request specific changes. You can ask for a different tone, more detail, different examples, or any other modifications. Each version is saved so you can compare.",
  },
  {
    question: "Is my data private?",
    answer: "Your course information and generated content are stored securely and are not shared with other users. Content generation uses AI services but your data is not used to train AI models.",
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

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/")}
              data-testid="button-back-home"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <HelpCircle className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Help & Resources</h1>
                <p className="text-sm text-muted-foreground">Learn how to use the BSU Instructional Design Tool</p>
              </div>
            </div>
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
                    <div className="text-sm">
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
    </div>
  );
}
