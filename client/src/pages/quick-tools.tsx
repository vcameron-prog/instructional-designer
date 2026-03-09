import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, ArrowRight, FileText, CheckCircle, Target, ShieldCheck, Eye, Bot, Zap } from "lucide-react";
import { TOOLS } from "@/lib/constants";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";

const QUICK_TOOL_IDS = ["assignment", "rubric", "alignment", "airesistant", "accessibility", "aistudent"];

const iconMap: Record<string, any> = {
  FileText,
  CheckCircle,
  Target,
  ShieldCheck,
  Eye,
  Bot,
};

export default function QuickTools() {
  const [, navigate] = useLocation();

  usePageTitle("Quick Tools");

  const quickTools = TOOLS.filter(t => QUICK_TOOL_IDS.includes(t.id));

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/")}
                aria-label="Back to home"
                data-testid="button-back-home"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">Quick Tools</h1>
                  <p className="text-sm text-muted-foreground">Create one-off materials without setting up a course</p>
                </div>
              </div>
            </div>
            <HeaderControls variant="light" showHome={true} />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-2">Select a Tool</h2>
          <p className="text-muted-foreground">
            Generate a one-off assignment, rubric, or other material. You can optionally provide subject and level for more tailored results.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {quickTools.map((tool, index) => {
            const Icon = iconMap[tool.icon];

            return (
              <Card
                key={tool.id}
                className="group cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg animate-fade-in-up"
                style={{ animationDelay: `${index * 50}ms` }}
                onClick={() => navigate(`/quick-tools/${tool.id}`)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/quick-tools/${tool.id}`); } }}
                tabIndex={0}
                role="button"
                data-testid={`card-quick-tool-${tool.id}`}
              >
                <CardHeader className="pb-3">
                  <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center text-white group-hover:scale-110 transition-transform">
                    {Icon && <Icon className="w-6 h-6" />}
                  </div>
                  <CardTitle className="text-lg mt-3 group-hover:text-primary transition-colors">
                    {tool.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm leading-relaxed">
                    {tool.description}
                  </CardDescription>
                  <Button variant="ghost" className="mt-4 p-0 h-auto text-primary font-medium group-hover:gap-2 transition-all">
                    Get Started <ArrowRight className="w-4 h-4 ml-1" aria-hidden="true" />
                  </Button>
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
