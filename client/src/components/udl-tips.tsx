import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Lightbulb, Users, Eye, Hand, Globe, Heart, Brain } from "lucide-react";

interface Tip {
  principle: string;
  icon: any;
  color: string;
  tip: string;
}

interface ToolTips {
  udl: Tip[];
  cultural: Tip[];
  sel: Tip[];
}

const allTips: Record<string, ToolTips> = {
  assignment: {
    udl: [
      {
        principle: "Engagement",
        icon: Users,
        color: "text-primary",
        tip: "Offer choice in topics or formats to increase student motivation and relevance.",
      },
      {
        principle: "Representation",
        icon: Eye,
        color: "text-primary",
        tip: "Provide clear examples and templates to support understanding of expectations.",
      },
      {
        principle: "Action & Expression",
        icon: Hand,
        color: "text-primary",
        tip: "Consider allowing multiple submission formats (written, video, audio) when possible.",
      },
    ],
    cultural: [
      {
        principle: "Diverse Perspectives",
        icon: Globe,
        color: "text-secondary",
        tip: "Include topics and examples that reflect diverse cultural backgrounds and experiences.",
      },
      {
        principle: "Student Identity",
        icon: Users,
        color: "text-secondary",
        tip: "Allow students to connect assignments to their own cultural experiences and communities.",
      },
      {
        principle: "Inclusive Language",
        icon: Globe,
        color: "text-secondary",
        tip: "Use inclusive language and avoid assumptions about students' backgrounds or experiences.",
      },
    ],
    sel: [
      {
        principle: "Self-Awareness",
        icon: Brain,
        color: "text-accent",
        tip: "Include reflection prompts that help students connect learning to personal growth.",
      },
      {
        principle: "Relationship Skills",
        icon: Heart,
        color: "text-accent",
        tip: "Consider collaborative elements that build teamwork and communication skills.",
      },
      {
        principle: "Responsible Decision-Making",
        icon: Brain,
        color: "text-accent",
        tip: "Include ethical considerations or real-world decision-making scenarios when relevant.",
      },
    ],
  },
  rubric: {
    udl: [
      {
        principle: "Engagement",
        icon: Users,
        color: "text-primary",
        tip: "Share rubrics early so students can self-assess their work before submission.",
      },
      {
        principle: "Representation",
        icon: Eye,
        color: "text-primary",
        tip: "Use clear, specific language that avoids jargon and defines key terms.",
      },
      {
        principle: "Action & Expression",
        icon: Hand,
        color: "text-primary",
        tip: "Include criteria that allow for diverse approaches to demonstrating learning.",
      },
    ],
    cultural: [
      {
        principle: "Equitable Assessment",
        icon: Globe,
        color: "text-secondary",
        tip: "Ensure criteria don't inadvertently favor certain cultural communication styles over others.",
      },
      {
        principle: "Diverse Excellence",
        icon: Users,
        color: "text-secondary",
        tip: "Define success in ways that recognize different cultural approaches to problem-solving.",
      },
      {
        principle: "Bias Review",
        icon: Globe,
        color: "text-secondary",
        tip: "Review rubric language for potential cultural bias or assumptions.",
      },
    ],
    sel: [
      {
        principle: "Growth Mindset",
        icon: Brain,
        color: "text-accent",
        tip: "Frame criteria around growth and improvement, not just final achievement.",
      },
      {
        principle: "Self-Assessment",
        icon: Heart,
        color: "text-accent",
        tip: "Consider including self-reflection criteria that develop metacognitive skills.",
      },
      {
        principle: "Constructive Feedback",
        icon: Brain,
        color: "text-accent",
        tip: "Design rubric language to provide supportive, actionable feedback.",
      },
    ],
  },
  module: {
    udl: [
      {
        principle: "Engagement",
        icon: Users,
        color: "text-primary",
        tip: "Include activities that connect content to real-world applications and student interests.",
      },
      {
        principle: "Representation",
        icon: Eye,
        color: "text-primary",
        tip: "Provide content in multiple formats (text, video, audio, visuals) to support different learners.",
      },
      {
        principle: "Action & Expression",
        icon: Hand,
        color: "text-primary",
        tip: "Build in opportunities for practice and low-stakes feedback before major assessments.",
      },
    ],
    cultural: [
      {
        principle: "Diverse Content",
        icon: Globe,
        color: "text-secondary",
        tip: "Include readings, examples, and case studies from diverse authors and perspectives.",
      },
      {
        principle: "Cultural Windows",
        icon: Users,
        color: "text-secondary",
        tip: "Provide 'windows' into other cultures and 'mirrors' where students see themselves reflected.",
      },
      {
        principle: "Global Perspectives",
        icon: Globe,
        color: "text-secondary",
        tip: "Connect topics to global contexts and diverse ways of knowing.",
      },
    ],
    sel: [
      {
        principle: "Belonging",
        icon: Heart,
        color: "text-accent",
        tip: "Design activities that help students feel connected to peers and the learning community.",
      },
      {
        principle: "Emotional Safety",
        icon: Brain,
        color: "text-accent",
        tip: "Include content warnings for sensitive topics and create psychologically safe discussions.",
      },
      {
        principle: "Stress Management",
        icon: Heart,
        color: "text-accent",
        tip: "Consider workload balance and include strategies for managing academic stress.",
      },
    ],
  },
  syllabus: {
    udl: [
      {
        principle: "Engagement",
        icon: Users,
        color: "text-primary",
        tip: "Use welcoming, student-centered language that sets a supportive tone for the course.",
      },
      {
        principle: "Representation",
        icon: Eye,
        color: "text-primary",
        tip: "Organize information clearly with headings, bullet points, and visual hierarchy.",
      },
      {
        principle: "Action & Expression",
        icon: Hand,
        color: "text-primary",
        tip: "Include multiple ways for students to seek help and demonstrate their learning.",
      },
    ],
    cultural: [
      {
        principle: "Inclusive Welcome",
        icon: Globe,
        color: "text-secondary",
        tip: "Include a diversity statement that genuinely welcomes students of all backgrounds.",
      },
      {
        principle: "Representation Matters",
        icon: Users,
        color: "text-secondary",
        tip: "Select course materials from diverse authors and perspectives.",
      },
      {
        principle: "Flexible Policies",
        icon: Globe,
        color: "text-secondary",
        tip: "Consider religious and cultural observances when setting deadlines and policies.",
      },
    ],
    sel: [
      {
        principle: "Supportive Tone",
        icon: Heart,
        color: "text-accent",
        tip: "Write policies with empathy—assume students want to succeed and may face challenges.",
      },
      {
        principle: "Wellness Resources",
        icon: Brain,
        color: "text-accent",
        tip: "Include mental health resources and normalize asking for help.",
      },
      {
        principle: "Community Building",
        icon: Heart,
        color: "text-accent",
        tip: "Set expectations for respectful, supportive peer interactions.",
      },
    ],
  },
  schedule: {
    udl: [
      {
        principle: "Engagement",
        icon: Users,
        color: "text-primary",
        tip: "Build in flexibility where possible to accommodate diverse student needs.",
      },
      {
        principle: "Representation",
        icon: Eye,
        color: "text-primary",
        tip: "Clearly mark important dates, deadlines, and what students need to prepare.",
      },
      {
        principle: "Action & Expression",
        icon: Hand,
        color: "text-primary",
        tip: "Space major assessments to allow adequate time for revision and feedback.",
      },
    ],
    cultural: [
      {
        principle: "Cultural Calendar",
        icon: Globe,
        color: "text-secondary",
        tip: "Be aware of major religious and cultural holidays when scheduling assessments.",
      },
      {
        principle: "Diverse Celebrations",
        icon: Users,
        color: "text-secondary",
        tip: "Consider acknowledging diverse heritage months and cultural events in course content.",
      },
      {
        principle: "Time Zone Equity",
        icon: Globe,
        color: "text-secondary",
        tip: "For online components, consider students in different time zones.",
      },
    ],
    sel: [
      {
        principle: "Sustainable Pacing",
        icon: Brain,
        color: "text-accent",
        tip: "Avoid clustering too many deadlines to reduce student stress and burnout.",
      },
      {
        principle: "Check-In Points",
        icon: Heart,
        color: "text-accent",
        tip: "Build in reflection or check-in moments to gauge student wellbeing.",
      },
      {
        principle: "Recovery Time",
        icon: Brain,
        color: "text-accent",
        tip: "Include lighter weeks after intensive periods to allow recovery.",
      },
    ],
  },
  aipolicy: {
    udl: [
      {
        principle: "Engagement",
        icon: Users,
        color: "text-primary",
        tip: "Explain the 'why' behind your policy to help students understand your reasoning.",
      },
      {
        principle: "Representation",
        icon: Eye,
        color: "text-primary",
        tip: "Provide concrete examples of acceptable vs. unacceptable AI use.",
      },
      {
        principle: "Action & Expression",
        icon: Hand,
        color: "text-primary",
        tip: "Consider how AI tools might support students with disabilities or language barriers.",
      },
    ],
    cultural: [
      {
        principle: "Access Equity",
        icon: Globe,
        color: "text-secondary",
        tip: "Recognize that not all students have equal access to AI tools outside of class.",
      },
      {
        principle: "Language Support",
        icon: Users,
        color: "text-secondary",
        tip: "Consider how multilingual students might appropriately use AI for language assistance.",
      },
      {
        principle: "Critical Perspective",
        icon: Globe,
        color: "text-secondary",
        tip: "Discuss how AI can reflect and perpetuate cultural biases.",
      },
    ],
    sel: [
      {
        principle: "Anxiety Reduction",
        icon: Brain,
        color: "text-accent",
        tip: "Frame the policy clearly to reduce student anxiety about unintentional violations.",
      },
      {
        principle: "Ethical Reasoning",
        icon: Heart,
        color: "text-accent",
        tip: "Help students develop their own ethical framework for AI use beyond this course.",
      },
      {
        principle: "Support Resources",
        icon: Brain,
        color: "text-accent",
        tip: "Emphasize human support resources (office hours, tutoring) alongside AI policies.",
      },
    ],
  },
  alignment: {
    udl: [
      {
        principle: "Engagement",
        icon: Users,
        color: "text-primary",
        tip: "Ensure assessments connect to outcomes students find meaningful and relevant.",
      },
      {
        principle: "Representation",
        icon: Eye,
        color: "text-primary",
        tip: "Check that learning activities prepare students for how they'll be assessed.",
      },
      {
        principle: "Action & Expression",
        icon: Hand,
        color: "text-primary",
        tip: "Offer multiple pathways to demonstrate mastery of learning outcomes.",
      },
    ],
    cultural: [
      {
        principle: "Outcome Equity",
        icon: Globe,
        color: "text-secondary",
        tip: "Review whether learning outcomes are achievable regardless of cultural background.",
      },
      {
        principle: "Diverse Pathways",
        icon: Users,
        color: "text-secondary",
        tip: "Ensure assessments don't privilege one cultural approach to demonstrating knowledge.",
      },
      {
        principle: "Inclusive Standards",
        icon: Globe,
        color: "text-secondary",
        tip: "Consider whether outcomes reflect diverse ways of knowing and demonstrating competence.",
      },
    ],
    sel: [
      {
        principle: "Holistic Growth",
        icon: Brain,
        color: "text-accent",
        tip: "Consider including social-emotional outcomes alongside academic ones.",
      },
      {
        principle: "Self-Regulation",
        icon: Heart,
        color: "text-accent",
        tip: "Include outcomes related to self-directed learning and time management.",
      },
      {
        principle: "Collaboration Skills",
        icon: Brain,
        color: "text-accent",
        tip: "If group work is included, explicitly assess interpersonal and teamwork skills.",
      },
    ],
  },
};

export function UdlTips({ toolId }: { toolId: string }) {
  const tips = allTips[toolId];
  const [activeTab, setActiveTab] = useState("udl");

  if (!tips) return null;

  return (
    <Card className="bg-muted/30 border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-primary" />
          <CardTitle className="text-base">Inclusive Design Tips</CardTitle>
        </div>
        <CardDescription className="text-sm">
          Consider these evidence-based principles as you design your course materials
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="udl" className="text-xs" data-testid="tab-udl">
              UDL
            </TabsTrigger>
            <TabsTrigger value="cultural" className="text-xs" data-testid="tab-cultural">
              Cultural Relevance
            </TabsTrigger>
            <TabsTrigger value="sel" className="text-xs" data-testid="tab-sel">
              SEL
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="udl" className="space-y-3 mt-0">
            <p className="text-xs text-muted-foreground mb-3">
              Universal Design for Learning creates flexible learning experiences for all students.
            </p>
            {tips.udl.map((tip, index) => {
              const Icon = tip.icon;
              return (
                <div key={index} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon className={`w-4 h-4 ${tip.color}`} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{tip.principle}</p>
                    <p className="text-sm text-muted-foreground">{tip.tip}</p>
                  </div>
                </div>
              );
            })}
          </TabsContent>
          
          <TabsContent value="cultural" className="space-y-3 mt-0">
            <p className="text-xs text-muted-foreground mb-3">
              Culturally responsive teaching honors diverse backgrounds and perspectives.
            </p>
            {tips.cultural.map((tip, index) => {
              const Icon = tip.icon;
              return (
                <div key={index} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-secondary/10 flex items-center justify-center flex-shrink-0">
                    <Icon className={`w-4 h-4 ${tip.color}`} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{tip.principle}</p>
                    <p className="text-sm text-muted-foreground">{tip.tip}</p>
                  </div>
                </div>
              );
            })}
          </TabsContent>
          
          <TabsContent value="sel" className="space-y-3 mt-0">
            <p className="text-xs text-muted-foreground mb-3">
              Social-Emotional Learning develops the whole student beyond academics.
            </p>
            {tips.sel.map((tip, index) => {
              const Icon = tip.icon;
              return (
                <div key={index} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                    <Icon className={`w-4 h-4 ${tip.color}`} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{tip.principle}</p>
                    <p className="text-sm text-muted-foreground">{tip.tip}</p>
                  </div>
                </div>
              );
            })}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
