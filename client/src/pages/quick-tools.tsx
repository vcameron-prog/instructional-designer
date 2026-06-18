import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, FileText, CheckCircle, Target, ShieldCheck, Eye, Bot, Zap, Clock, Trash2 } from "lucide-react";
import { TOOLS } from "@/lib/constants";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/hooks/use-auth";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type RecentQuickToolResult = {
  id: number;
  toolType: string;
  toolName: string;
  createdAt: string | Date | null;
  formData: unknown;
  contentPreview: string;
};

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
  const { toast } = useToast();

  usePageTitle("Quick Tools");
  useEffect(() => { window.scrollTo(0, 0); }, []);

  const [preferredTool] = useState(() => localStorage.getItem("bsu-preferred-quick-tool") || "");

  const quickTools = TOOLS.filter(t => QUICK_TOOL_IDS.includes(t.id));

  const { data: recentResults, isLoading: historyLoading, isError: historyError } = useQuery<RecentQuickToolResult[]>({
    queryKey: ["/api/content/recent-quick-tools"],
    enabled: isAuthenticated,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/content/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/content/recent-quick-tools"] });
      toast({ title: "Result deleted", description: "The result has been removed from your history." });
    },
    onError: () => {
      toast({ title: "Delete failed", description: "Could not delete the result. Please try again.", variant: "destructive" });
    },
  });

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
                className={`group cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg animate-fade-in-up${preferredTool === tool.id ? " ring-2 ring-primary/40" : ""}`}
                style={{ animationDelay: `${index * 50}ms` }}
                onClick={() => navigate(`/quick-tools/${tool.id}`)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/quick-tools/${tool.id}`); } }}
                tabIndex={0}
                role="button"
                data-testid={`card-quick-tool-${tool.id}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center text-white group-hover:scale-110 transition-transform">
                      {Icon && <Icon className="w-6 h-6" />}
                    </div>
                    {preferredTool === tool.id && (
                      <Badge variant="secondary" className="text-xs shrink-0" data-testid={`badge-preferred-${tool.id}`}>
                        Preferred
                      </Badge>
                    )}
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

        {isAuthenticated && <div className="mt-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Clock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Recent Results</h2>
              <p className="text-sm text-muted-foreground">Your last Quick Tool generations</p>
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

          {!historyLoading && !historyError && (!recentResults || recentResults.length === 0) && (
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

          {!historyLoading && !historyError && recentResults && recentResults.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {recentResults.map((item) => {
                const ToolIcon = toolIconByType[item.toolType] || FileText;
                return (
                  <Card
                    key={item.id}
                    className="group relative cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
                    onClick={() => navigate(`/quick-tools/result/${item.id}`)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/quick-tools/result/${item.id}`); } }}
                    tabIndex={0}
                    role="button"
                    aria-label={`View ${item.toolName}${item.createdAt ? ` generated on ${format(new Date(item.createdAt), "MMM d, yyyy")}` : ""}`}
                    data-testid={`card-history-${item.id}`}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all z-10"
                      aria-label={`Delete ${item.toolName} result`}
                      data-testid={`button-delete-result-${item.id}`}
                      disabled={deleteMutation.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMutation.mutate(item.id);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
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
                            {item.contentPreview}{item.contentPreview.length >= 120 ? "..." : ""}
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
        </div>}
      </div>
      <PoweredByFooter />
    </main>
  );
}
