import { useLocation } from "wouter";
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
  Globe,
  Heart,
  GraduationCap,
  Scale
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

const researchFrameworks = {
  udl: {
    title: "Universal Design for Learning (UDL)",
    icon: Lightbulb,
    color: "text-primary",
    bgColor: "bg-primary/10",
    theory: "UDL is a framework developed by CAST (Center for Applied Special Technology) based on neuroscience research about how the brain learns. It recognizes that learners vary in how they are motivated, how they perceive and comprehend information, and how they navigate learning environments.",
    keyResearch: [
      {
        citation: "Meyer, A., Rose, D.H., & Gordon, D. (2014). Universal Design for Learning: Theory and Practice. CAST Professional Publishing.",
        description: "The foundational text establishing UDL principles based on learning sciences research.",
      },
      {
        citation: "Rose, D.H., & Meyer, A. (2002). Teaching Every Student in the Digital Age: Universal Design for Learning. ASCD.",
        description: "Connects neuroscience findings to practical classroom applications.",
      },
      {
        citation: "Tobin, T.J., & Behling, K.T. (2018). Reach Everyone, Teach Everyone: Universal Design for Learning in Higher Education. West Virginia University Press.",
        description: "Applies UDL specifically to college and university settings.",
      },
    ],
    resources: [
      { name: "CAST UDL Guidelines", url: "https://udlguidelines.cast.org/", description: "Official interactive guidelines" },
      { name: "UDL on Campus", url: "https://udloncampus.cast.org/", description: "Higher education resources" },
      { name: "National Center on UDL", url: "https://www.cast.org/", description: "Research and professional development" },
    ],
  },
  cultural: {
    title: "Culturally Responsive Teaching",
    icon: Globe,
    color: "text-secondary",
    bgColor: "bg-secondary/10",
    theory: "Culturally Responsive Teaching (CRT) is a pedagogy that recognizes the importance of including students' cultural references in all aspects of learning. It builds on the premise that when academic knowledge and skills are situated within the lived experiences of students, they are more personally meaningful and easier to master.",
    keyResearch: [
      {
        citation: "Gay, G. (2018). Culturally Responsive Teaching: Theory, Research, and Practice (3rd ed.). Teachers College Press.",
        description: "Seminal work defining culturally responsive pedagogy and its research base.",
      },
      {
        citation: "Ladson-Billings, G. (1995). Toward a Theory of Culturally Relevant Pedagogy. American Educational Research Journal, 32(3), 465-491.",
        description: "Foundational research establishing culturally relevant pedagogy framework.",
      },
      {
        citation: "Hammond, Z. (2015). Culturally Responsive Teaching and the Brain. Corwin.",
        description: "Connects cultural responsiveness to neuroscience of learning.",
      },
    ],
    resources: [
      { name: "Culturally Responsive Teaching", url: "https://www.tolerance.org/magazine/publications/critical-practices-for-antibias-education", description: "Learning for Justice resources" },
      { name: "NYU Steinhardt - CRT", url: "https://steinhardt.nyu.edu/metrocenter/culturally-responsive-curriculum-scorecards", description: "Curriculum assessment tools" },
      { name: "Equity Literacy Institute", url: "https://www.equityliteracy.org/", description: "Research and practice resources" },
    ],
  },
  sel: {
    title: "Social-Emotional Learning (SEL)",
    icon: Heart,
    color: "text-accent",
    bgColor: "bg-accent/10",
    theory: "Social-Emotional Learning is the process through which individuals acquire and apply knowledge, skills, and attitudes to develop healthy identities, manage emotions, achieve goals, feel and show empathy, establish relationships, and make responsible decisions. Research shows SEL improves academic outcomes, behavior, and lifelong wellbeing.",
    keyResearch: [
      {
        citation: "Durlak, J.A., et al. (2011). The Impact of Enhancing Students' Social and Emotional Learning: A Meta-Analysis of School-Based Universal Interventions. Child Development, 82(1), 405-432.",
        description: "Meta-analysis of 213 studies showing 11-percentile gain in academic achievement with SEL.",
      },
      {
        citation: "CASEL (2020). CASEL's SEL Framework: What Are the Core Competence Areas and Where Are They Promoted? Collaborative for Academic, Social, and Emotional Learning.",
        description: "Framework defining five core SEL competencies used worldwide.",
      },
      {
        citation: "Jones, S.M., & Kahn, J. (2017). The Evidence Base for How We Learn: Supporting Students' Social, Emotional, and Academic Development. The Aspen Institute.",
        description: "Comprehensive review of SEL research for policymakers and practitioners.",
      },
    ],
    resources: [
      { name: "CASEL", url: "https://casel.org/", description: "Collaborative for Academic, Social, and Emotional Learning" },
      { name: "Edutopia SEL", url: "https://www.edutopia.org/social-emotional-learning", description: "Practical resources and articles" },
      { name: "Yale Center for Emotional Intelligence", url: "https://www.ycei.org/", description: "RULER approach and research" },
    ],
  },
  grading: {
    title: "Grading for Equity",
    icon: Scale,
    color: "text-primary",
    bgColor: "bg-primary/10",
    theory: "Grading for Equity is a framework that challenges traditional grading practices that often measure compliance, behavior, and privilege rather than actual learning. It emphasizes grading practices that are accurate (reflecting only content mastery), bias-resistant (avoiding subjective factors), and motivational (supporting student growth rather than punishment).",
    keyResearch: [
      {
        citation: "Feldman, J. (2018). Grading for Equity: What It Is, Why It Matters, and How It Can Transform Schools and Classrooms. Corwin Press.",
        description: "The foundational text establishing equitable grading principles and practical implementation strategies.",
      },
      {
        citation: "Brookhart, S.M. (2011). Grading and Learning: Practices That Support Student Achievement. Solution Tree Press.",
        description: "Research on how grading practices impact student motivation and learning outcomes.",
      },
      {
        citation: "Guskey, T.R., & Bailey, J.M. (2001). Developing Grading and Reporting Systems for Student Learning. Corwin Press.",
        description: "Framework for designing standards-based grading systems that focus on learning.",
      },
      {
        citation: "Schimmer, T., Hillman, G., & Stalets, M. (2018). Standards-Based Learning in Action. Solution Tree Press.",
        description: "Practical guide to implementing standards-based grading in higher education.",
      },
    ],
    resources: [
      { name: "Grading for Equity", url: "https://gradingforequity.org/", description: "Official resources from Joe Feldman" },
      { name: "ASCD - Equitable Grading", url: "https://www.ascd.org/topics/grading", description: "Articles and research on grading practices" },
      { name: "Cult of Pedagogy - Grading", url: "https://www.cultofpedagogy.com/grading-for-equity/", description: "Practical guides and discussions" },
    ],
  },
};

export default function HelpPage() {
  const [, navigate] = useLocation();

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
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            Design Tools
          </h2>
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
            </CardContent>
          </Card>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <GraduationCap className="w-6 h-6 text-primary" />
            Research & Theory: Why These Frameworks Matter
          </h2>
          <p className="text-muted-foreground mb-6">
            This tool incorporates three evidence-based pedagogical frameworks. Here's the research behind why 
            they're included in all generated content.
          </p>
          
          <div className="space-y-6">
            {Object.entries(researchFrameworks).map(([key, framework]) => {
              const Icon = framework.icon;
              return (
                <Card key={key}>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg ${framework.bgColor} flex items-center justify-center`}>
                        <Icon className={`w-5 h-5 ${framework.color}`} />
                      </div>
                      <CardTitle>{framework.title}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div>
                      <h4 className="font-semibold mb-2">Theoretical Foundation</h4>
                      <p className="text-muted-foreground">{framework.theory}</p>
                    </div>
                    
                    <div>
                      <h4 className="font-semibold mb-3">Key Research</h4>
                      <div className="space-y-3">
                        {framework.keyResearch.map((research, i) => (
                          <div key={i} className="border-l-2 border-muted pl-4">
                            <p className="text-sm font-medium">{research.citation}</p>
                            <p className="text-sm text-muted-foreground mt-1">{research.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div>
                      <h4 className="font-semibold mb-3">Resources & Further Reading</h4>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {framework.resources.map((resource, i) => (
                          <a
                            key={i}
                            href={resource.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-start gap-2 p-3 rounded-lg border hover-elevate overflow-visible"
                            data-testid={`link-resource-${key}-${i}`}
                          >
                            <ExternalLink className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-sm font-medium">{resource.name}</p>
                              <p className="text-xs text-muted-foreground">{resource.description}</p>
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
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
    </div>
  );
}
