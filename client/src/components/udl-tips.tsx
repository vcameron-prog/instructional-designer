import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Lightbulb, Users, Eye, Hand } from "lucide-react";

interface UdlTip {
  principle: string;
  icon: any;
  color: string;
  tip: string;
}

const udlTips: Record<string, UdlTip[]> = {
  assignment: [
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
  rubric: [
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
  module: [
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
  syllabus: [
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
  schedule: [
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
  aipolicy: [
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
  alignment: [
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
};

export function UdlTips({ toolId }: { toolId: string }) {
  const tips = udlTips[toolId] || [];

  if (tips.length === 0) return null;

  return (
    <Card className="bg-primary/5 border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-primary" />
          <CardTitle className="text-base">UDL Design Tips</CardTitle>
        </div>
        <CardDescription className="text-sm">
          Consider these Universal Design for Learning principles as you configure this tool
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {tips.map((tip, index) => {
          const Icon = tip.icon;
          return (
            <div key={index} className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center flex-shrink-0">
                <Icon className={`w-4 h-4 ${tip.color}`} />
              </div>
              <div>
                <p className="text-sm font-medium">{tip.principle}</p>
                <p className="text-sm text-muted-foreground">{tip.tip}</p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
