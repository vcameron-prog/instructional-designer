import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, FileText, CheckCircle, Target, ShieldCheck, Eye, Bot, Zap, Clock, Loader2 } from "lucide-react";
import { TOOLS } from "@/lib/constants";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/hooks/use-auth";
import { format } from "date-fns";
import type { GeneratedContent } from "@shared/schema";

const QUICK_TOOL_IDS = ["assignment", "rubric", "alignment", "airesistant", "accessibility", "aistudent"];

const iconMap: Record<string, any> = {
  FileText,
  CheckCircle,
  Target,
  ShieldCheck,
  Eye,
  Bot,
};

const toolIconByType: Record<string, any> = {
  assignment: FileText,
  rubric: CheckCircle,
  alignment: Target,
  airesistant: ShieldCheck,
  accessibility: Eye,
  aistudent: Bot,
};

export default function QuickTools() {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();

  usePageTitle("Quick Tools");
  useEffect(() => { window.scrollTo(0, 0); }, []);

  const quickTools = TOOLS.filter(t => QUICK_TOOL_IDS.includes(t.id));

  const { data: history, isLoading: historyLoading, isError: historyError } = useQuery<GeneratedContent[]>({
    queryKey: ["/api/standalone-content"],
    enabled: isAuthenticated,
  });

  const filteredHistory = isAuthenticated ? history?.filter(item => QUICK_TOOL_IDS.includes(item.toolType)) : undefined;

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

        <div className="mt-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Clock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Your Quick Tools History</h2>
              <p className="text-sm text-muted-foreground">Previously generated standalone content</p>
            </div>
          </div>

          {historyLoading && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" role="status">
              {[1, 2, 3].map(i => (
                <Card key={i}>
                  <CardContent className="p-5 space-y-3">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-3 w-1/3 mt-2" />
                  </CardContent>
                </Card>
              ))}
              <span className="sr-only">Loading your quick tools history</span>
            </div>
          )}

          {!historyLoading && historyError && (
            <Card className="bg-destructive/5 border-destructive/20">
              <CardContent className="p-6 text-center">
                <p className="text-muted-foreground font-medium">Could not load your history</p>
                <p className="text-sm text-muted-foreground mt-1">Please try refreshing the page</p>
              </CardContent>
            </Card>
          )}

          {!historyLoading && !historyError && (!filteredHistory || filteredHistory.length === 0) && (
            <Card className="bg-muted/30 border-dashed">
              <CardContent className="p-8 text-center">
                <Zap className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" aria-hidden="true" />
                <p className="text-muted-foreground font-medium">No quick tools content yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Select a tool above to generate your first standalone material
                </p>
              </CardContent>
            </Card>
          )}

          {!historyLoading && !historyError && filteredHistory && filteredHistory.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredHistory.map((item) => {
                const ToolIcon = toolIconByType[item.toolType] || FileText;
                const preview = item.content
                  .replace(/^#+\s.*$/gm, "")
                  .replace(/\*\*/g, "")
                  .replace(/\n+/g, " ")
                  .trim()
                  .slice(0, 120);

                return (
                  <Card
                    key={item.id}
                    className="group cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
                    onClick={() => navigate(`/quick-tools/result/${item.id}`)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/quick-tools/result/${item.id}`); } }}
                    tabIndex={0}
                    role="button"
                    aria-label={`View ${item.toolName}${item.createdAt ? ` generated on ${format(new Date(item.createdAt), "MMM d, yyyy")}` : ""}`}
                    data-testid={`card-history-${item.id}`}
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <ToolIcon className="w-4 h-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-sm group-hover:text-primary transition-colors truncate">
                              {item.toolName}
                            </h3>
                            {item.formData && typeof item.formData === "object" && (item.formData as any).subject && (
                              <Badge variant="secondary" className="text-xs font-normal">
                                {(item.formData as any).subject}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
                            {preview}{preview.length >= 120 ? "..." : ""}
                          </p>
                          {item.createdAt && (
                          <p className="text-xs text-muted-foreground/70 mt-2" data-testid={`text-date-${item.id}`}>
                            {format(new Date(item.createdAt), "MMM d, yyyy")}
                          </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <PoweredByFooter />
    </main>
  );
}
