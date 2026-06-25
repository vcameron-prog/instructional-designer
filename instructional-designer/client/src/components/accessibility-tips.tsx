import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, Ear, Brain, Hand, MessageSquare, FileText } from "lucide-react";

interface Tip {
  area: string;
  icon: any;
  color: string;
  tip: string;
}

const accessibilityTips: Tip[] = [
  {
    area: "Visual Accessibility",
    icon: Eye,
    color: "text-primary",
    tip: "Ensure sufficient color contrast, provide alt text for images, and don't rely on color alone to convey information.",
  },
  {
    area: "Cognitive Accessibility",
    icon: Brain,
    color: "text-primary",
    tip: "Use clear, simple language. Break content into manageable chunks. Provide consistent navigation and layout.",
  },
  {
    area: "Motor Accessibility",
    icon: Hand,
    color: "text-primary",
    tip: "Ensure all interactive elements can be accessed via keyboard. Provide adequate time for timed activities.",
  },
  {
    area: "Auditory Accessibility",
    icon: Ear,
    color: "text-primary",
    tip: "Provide captions for videos and transcripts for audio. Don't rely solely on audio cues for important information.",
  },
  {
    area: "Language Accessibility",
    icon: MessageSquare,
    color: "text-primary",
    tip: "Avoid jargon, define technical terms, and consider providing content in multiple formats for diverse learners.",
  },
];

const quickChecklist = [
  "Are all images described with alt text?",
  "Is text readable at 200% zoom?",
  "Do videos have captions?",
  "Is the reading level appropriate?",
  "Are instructions clear and specific?",
  "Are there multiple ways to access content?",
];

export function AccessibilityTips() {
  return (
    <Card className="bg-muted/30 border-border" data-testid="card-accessibility-tips">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Eye className="w-5 h-5 text-primary" />
          <CardTitle className="text-base" data-testid="text-accessibility-guide-title">Accessibility Quick Guide</CardTitle>
        </div>
        <CardDescription className="text-sm">
          Key considerations for creating accessible course content
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3" data-testid="section-accessibility-areas">
          {accessibilityTips.map((tip, index) => {
            const Icon = tip.icon;
            return (
              <div key={index} className="flex items-start gap-3" data-testid={`tip-accessibility-${index}`}>
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon className={`w-4 h-4 ${tip.color}`} />
                </div>
                <div>
                  <p className="text-sm font-medium" data-testid={`text-tip-area-${index}`}>{tip.area}</p>
                  <p className="text-sm text-muted-foreground">{tip.tip}</p>
                </div>
              </div>
            );
          })}
        </div>
        
        <div className="pt-3 border-t" data-testid="section-quick-checklist">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-primary" />
            <p className="text-sm font-medium" data-testid="text-checklist-title">Quick Checklist</p>
          </div>
          <ul className="text-sm text-muted-foreground space-y-1">
            {quickChecklist.map((item, index) => (
              <li key={index} className="flex items-start gap-2" data-testid={`checklist-item-${index}`}>
                <span className="text-primary mt-0.5">•</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
