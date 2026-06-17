import { useLocation } from "wouter";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { usePageTitle } from "@/hooks/use-page-title";
import { HeaderControls } from "@/components/header-controls";
import { 
  ArrowLeft, 
  ExternalLink,
  Globe,
  Heart,
  GraduationCap,
  Lightbulb,
  Scale,
  HelpCircle,
  ShieldCheck,
  Eye,
  List,
  Bot
} from "lucide-react";

const researchFrameworks = {
  accessibility: {
    title: "Accessibility in Education",
    icon: Eye,
    color: "text-primary",
    bgColor: "bg-primary/10",
    theory: "Accessible education ensures that all students, including those with disabilities, can fully participate in learning experiences. This framework draws on legal requirements (ADA, Section 508), international standards (WCAG 2.1), and cognitive science research to create course materials that work for everyone. Accessibility is not just compliance—it's about removing barriers and creating equitable learning opportunities through proactive, inclusive design.",
    keyResearch: [
      {
        citation: "World Wide Web Consortium (W3C). (2018). Web Content Accessibility Guidelines (WCAG) 2.1. W3C Recommendation.",
        description: "International standard defining how to make digital content accessible to people with disabilities.",
      },
      {
        citation: "Burgstahler, S. (2015). Universal Design in Higher Education: From Principles to Practice (2nd ed.). Harvard Education Press.",
        description: "Comprehensive guide to applying universal design principles across all aspects of higher education.",
      },
      {
        citation: "Sweller, J. (2011). Cognitive Load Theory. Psychology of Learning and Motivation, 55, 37-76.",
        description: "Research on how cognitive load affects learning, informing accessible instructional design.",
      },
      {
        citation: "Mayer, R.E. (2014). The Cambridge Handbook of Multimedia Learning (2nd ed.). Cambridge University Press.",
        description: "Evidence-based principles for designing accessible multimedia learning materials.",
      },
      {
        citation: "Rose, D.H., Harbour, W.S., Johnston, C.S., Daley, S.G., & Abarbanell, L. (2006). Universal Design for Learning in Postsecondary Education. Journal of Postsecondary Education and Disability, 19(2), 135-151.",
        description: "Research connecting UDL principles to accessibility in higher education contexts.",
      },
    ],
    resources: [
      { name: "BSU Student Accessibility Services", url: "https://www.bridgew.edu/academics/academic-achievement/student-accessibility-services", description: "BSU campus accessibility resources" },
      { name: "WebAIM", url: "https://webaim.org/", description: "Web accessibility training and resources" },
      { name: "WCAG 2.1 Guidelines", url: "https://www.w3.org/WAI/WCAG21/quickref/", description: "Quick reference for accessibility standards" },
      { name: "Section 508", url: "https://www.section508.gov/", description: "Federal accessibility requirements" },
      { name: "AHEAD", url: "https://www.ahead.org/", description: "Association on Higher Education and Disability" },
    ],
  },
  aipowered: {
    title: "AI-Powered Pedagogy",
    icon: Bot,
    color: "text-primary",
    bgColor: "bg-primary/10",
    theory: "AI-Powered Pedagogy is an emerging framework that focuses on the intentional integration of artificial intelligence into student learning activities. Rather than treating AI as a threat to academic integrity, this approach leverages AI as a pedagogical tool to enhance learning through evidence-based strategies. Key principles include applying Bloom's taxonomy to AI interactions (moving students from lower-order tasks like generating content to higher-order tasks like evaluating and synthesizing AI output), embedding metacognitive reflection throughout AI-assisted activities, and developing AI literacy competencies that prepare students for an AI-augmented workforce. Research shows that structured AI integration can deepen critical thinking, improve writing through iterative AI-assisted revision, and help students develop essential skills in prompt engineering, output evaluation, and ethical AI use.",
    keyResearch: [
      {
        citation: "EDUCAUSE Review (2025). AI-Powered Pedagogy: A Guide to Evidence-Based Teaching Tools. EDUCAUSE.",
        description: "Comprehensive guide to evidence-based approaches for integrating AI tools into teaching and learning in higher education.",
      },
      {
        citation: "Mollick, E.R. & Mollick, L. (2023). Using AI to Implement Effective Teaching Strategies in Classrooms: Five Strategies, Including Prompts. Wharton School Research Paper.",
        description: "Research from Wharton on practical AI-enhanced teaching strategies including AI-assisted practice, feedback, and Socratic dialogue.",
      },
      {
        citation: "Bowen, J.A. & Watson, C.E. (2024). Teaching with AI: A Practical Guide to a New Era of Human Learning. Johns Hopkins University Press.",
        description: "Practical framework for educators to thoughtfully integrate AI into course design while maintaining focus on human learning outcomes.",
      },
      {
        citation: "UNESCO (2023). Guidance for Generative AI in Education and Research. United Nations Educational, Scientific and Cultural Organization.",
        description: "Global framework providing policy guidance on the ethical and pedagogically sound use of generative AI in educational settings.",
      },
    ],
    resources: [
      { name: "EDUCAUSE AI-Powered Pedagogy", url: "https://er.educause.edu/articles/2025/12/ai-powered-pedagogy-a-guide-to-evidence-based-teaching-tools", description: "Evidence-based teaching tools guide" },
      { name: "Anthropic Skilljar", url: "https://anthropic.skilljar.com/", description: "AI education and training resources" },
      { name: "BSU Center for Artificial Intelligence", url: "https://www.bridgew.edu/center/artificial-intelligence", description: "BSU campus AI resources" },
      { name: "ISTE - AI in Education", url: "https://www.iste.org/areas-of-focus/AI-in-education", description: "Resources for teaching with and about AI" },
    ],
  },
  airesistant: {
    title: "AI-Resistant Assignment Design",
    icon: ShieldCheck,
    color: "text-primary",
    bgColor: "bg-primary/10",
    theory: "As generative AI becomes increasingly capable, educators face new challenges in designing assignments that authentically assess student learning. AI-resistant assignment design draws on research in authentic assessment, academic integrity, and learning sciences to create assignments that require genuine student engagement while being difficult for AI to complete authentically. These strategies focus on leveraging what humans do best: personal reflection, local knowledge, process documentation, and multimodal expression.",
    keyResearch: [
      {
        citation: "Eaton, S.E. (2023). Postplagiarism: Transdisciplinary Ethics and Integrity in the Age of Artificial Intelligence. International Journal for Educational Integrity, 19(1).",
        description: "Explores how academic integrity must evolve beyond plagiarism detection to embrace authentic assessment in the AI era.",
      },
      {
        citation: "Perkins, M., Roe, J., et al. (2024). Academic Integrity Considerations of AI Large Language Models in the Post-Pandemic Era. Journal of University Teaching & Learning Practice, 21(2).",
        description: "Comprehensive analysis of how LLMs challenge traditional assessment and strategies for authentic evaluation.",
      },
      {
        citation: "Wiggins, G. & McTighe, J. (2005). Understanding by Design (2nd ed.). ASCD.",
        description: "Foundational framework for authentic assessment design that naturally resists AI completion through genuine understanding.",
      },
      {
        citation: "Dawson, P. (2021). Defending Assessment Security in a Digital World. Routledge.",
        description: "Strategies for maintaining assessment validity when students have access to digital tools and resources.",
      },
    ],
    resources: [
      { name: "BSU Center for Artificial Intelligence", url: "https://www.bridgew.edu/center/artificial-intelligence", description: "BSU campus AI resources" },
      { name: "ISTE - AI in Education", url: "https://www.iste.org/areas-of-focus/AI-in-education", description: "Resources for teaching with and about AI" },
      { name: "Stanford HAI", url: "https://hai.stanford.edu/education", description: "Human-centered AI education research" },
      { name: "UNESCO AI & Education", url: "https://www.unesco.org/en/digital-education/artificial-intelligence", description: "Global frameworks for AI in education" },
    ],
  },
  cultural: {
    title: "Culturally Responsive Teaching",
    icon: Globe,
    color: "text-primary",
    bgColor: "bg-primary/10",
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
      { name: "BSU Lewis and Gaines Center for Inclusion and Equity", url: "https://www.bridgew.edu/student-life/lgcie", description: "BSU campus inclusion resources" },
      { name: "Culturally Responsive Teaching", url: "https://www.tolerance.org/magazine/publications/critical-practices-for-antibias-education", description: "Learning for Justice resources" },
      { name: "NYU Steinhardt - CRT", url: "https://steinhardt.nyu.edu/metrocenter/culturally-responsive-curriculum-scorecards", description: "Curriculum assessment tools" },
      { name: "Equity Literacy Institute", url: "https://www.equityliteracy.org/", description: "Research and practice resources" },
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
      { name: "BSU Office of Assessment", url: "https://www.bridgew.edu/office/assessment", description: "BSU campus assessment resources" },
      { name: "Grading for Equity", url: "https://gradingforequity.org/", description: "Official resources from Joe Feldman" },
      { name: "ASCD - Equitable Grading", url: "https://www.ascd.org/topics/grading", description: "Articles and research on grading practices" },
      { name: "Cult of Pedagogy - Grading", url: "https://www.cultofpedagogy.com/grading-for-equity/", description: "Practical guides and discussions" },
    ],
  },
  sel: {
    title: "Social-Emotional Learning (SEL)",
    icon: Heart,
    color: "text-primary",
    bgColor: "bg-primary/10",
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
      { name: "BSU Wellness Center", url: "https://www.bridgew.edu/student-life/wellness", description: "BSU campus wellness resources" },
      { name: "CASEL", url: "https://casel.org/", description: "Collaborative for Academic, Social, and Emotional Learning" },
      { name: "Edutopia SEL", url: "https://www.edutopia.org/social-emotional-learning", description: "Practical resources and articles" },
      { name: "Yale Center for Emotional Intelligence", url: "https://www.ycei.org/", description: "RULER approach and research" },
    ],
  },
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
      { name: "BSU Academic Achievement Center", url: "https://www.bridgew.edu/academics/academic-achievement", description: "BSU campus academic support" },
      { name: "BSU Teaching and Technology Center", url: "https://bridgew.teamdynamix.com/TDClient/1926/Portal/KB/?CategoryID=11588", description: "BSU teaching resources and support" },
      { name: "CAST UDL Guidelines", url: "https://udlguidelines.cast.org/", description: "Official interactive guidelines" },
      { name: "UDL on Campus", url: "https://udloncampus.cast.org/", description: "Higher education resources" },
      { name: "National Center on UDL", url: "https://www.cast.org/", description: "Research and professional development" },
    ],
  },
};

export default function ResearchPage() {
  const [, navigate] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const fromPath = searchParams.get("from");

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handleBack = () => {
    navigate(fromPath || "/");
  };

  usePageTitle("Research & Theory");

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
                  <GraduationCap className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">Research & Theory</h1>
                  <p className="text-sm text-muted-foreground">Evidence-based frameworks behind the BSU Accessibility Tool</p>
                </div>
              </div>
            </div>
            <HeaderControls variant="light" showHome={true} />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-muted-foreground">
            This tool incorporates seven evidence-based pedagogical frameworks. Here's the research behind why 
            they're included in generated content.
          </p>
          <Button
            variant="outline"
            onClick={() => navigate("/help")}
            data-testid="link-help"
          >
            <HelpCircle className="w-4 h-4 mr-2" />
            Help & Resources
          </Button>
        </div>

        <Card className="mb-8">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-3">
              <List className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Topics on This Page</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(researchFrameworks).map(([key, framework]) => {
                const Icon = framework.icon;
                return (
                  <Button
                    key={key}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const el = document.getElementById(`framework-${key}`);
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    data-testid={`toc-link-${key}`}
                  >
                    <Icon className={`w-4 h-4 mr-1.5 ${framework.color}`} />
                    {framework.title}
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>
        
        <div className="space-y-6">
          {Object.entries(researchFrameworks).map(([key, framework]) => {
            const Icon = framework.icon;
            return (
              <Card key={key} id={`framework-${key}`} className="scroll-mt-24">
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
      </div>
      <PoweredByFooter />
    </main>
  );
}
