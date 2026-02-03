import { useLocation } from "wouter";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  ArrowLeft, 
  ExternalLink,
  Globe,
  Heart,
  GraduationCap,
  Lightbulb,
  Scale,
  HelpCircle
} from "lucide-react";

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

export default function ResearchPage() {
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
                <GraduationCap className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Research & Theory</h1>
                <p className="text-sm text-muted-foreground">Evidence-based frameworks behind the BSU Instructional Design Tool</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-8 flex items-center justify-between">
          <p className="text-muted-foreground">
            This tool incorporates four evidence-based pedagogical frameworks. Here's the research behind why 
            they're included in all generated content.
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
      </div>
    </div>
  );
}
