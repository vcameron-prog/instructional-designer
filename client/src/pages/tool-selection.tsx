import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, BookOpen, Calendar, FileText, Layout, CheckCircle, Sparkles, Target, ArrowRight, FolderOpen, Loader2, Scale, ShieldCheck, Link2, HelpCircle, GraduationCap, Library, Eye, Wrench, Pencil, Bot, AlertTriangle, Download } from "lucide-react";
import { TOOLS } from "@/lib/constants";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import { useToast } from "@/hooks/use-toast";
import type { Course, GeneratedContent } from "@shared/schema";
import { Badge } from "@/components/ui/badge";

const iconMap: Record<string, any> = {
  BookOpen,
  Calendar,
  FileText,
  Layout,
  CheckCircle,
  Sparkles,
  Target,
  Scale,
  ShieldCheck,
  Eye,
  Bot,
};

const colorMap: Record<string, string> = {
  primary: "bg-primary",
  secondary: "bg-secondary",
  accent: "bg-accent",
};

export default function ToolSelection() {
  const params = useParams();
  const courseId = params.id ? parseInt(params.id) : undefined;
  const [, navigate] = useLocation();
  const [isExporting, setIsExporting] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const { toast } = useToast();
  useEffect(() => { window.scrollTo(0, 0); }, []);

  const openExportModal = (contents: GeneratedContent[]) => {
    setSelectedIds(new Set(contents.map(c => c.id)));
    setExportModalOpen(true);
  };

  const toggleId = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDownloadSelected = () => {
    if (!courseId || isExporting || selectedIds.size === 0) return;
    setIsExporting(true);
    setExportModalOpen(false);
    const ids = Array.from(selectedIds).join(",");
    const a = document.createElement("a");
    a.href = `/api/courses/${courseId}/export?ids=${ids}`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    const count = selectedIds.size;
    toast({
      title: `Downloading ${count} ${count === 1 ? "material" : "materials"} as a ZIP…`,
      duration: 4000,
    });
    setTimeout(() => setIsExporting(false), 3000);
  };

  const { data: course, isLoading: isLoadingCourse } = useQuery<Course>({
    queryKey: ["/api/courses", courseId],
    enabled: !!courseId,
  });

  const { data: generatedContents = [] } = useQuery<GeneratedContent[]>({
    queryKey: ["/api/courses", courseId, "content"],
    enabled: !!courseId,
  });

  const { data: toolUsageData } = useQuery<{ usedTools: string[] }>({
    queryKey: ["/api/courses", courseId, "tool-usage"],
    enabled: !!courseId,
  });

  const usedToolSet = new Set<string>(toolUsageData?.usedTools ?? []);

  usePageTitle(course ? "Design Tools - " + course.courseName : "Design Tools");

  if (isLoadingCourse) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 flex items-center justify-center">
          <div role="status">
            <Loader2 className="w-8 h-8 animate-spin text-primary" aria-hidden="true" />
            <span className="sr-only">Loading course tools</span>
          </div>
        </div>
        <PoweredByFooter />
      </main>
    );
  }

  if (!course) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 flex items-center justify-center">
          <Card className="max-w-md">
            <CardContent className="p-6 text-center">
              <p className="text-muted-foreground">Course not found</p>
              <Button className="mt-4" onClick={() => navigate("/")}>
                Return Home
              </Button>
            </CardContent>
          </Card>
        </div>
        <PoweredByFooter />
      </main>
    );
  }

  const getContentCount = (toolId: string) => {
    return generatedContents.filter(c => c.toolType === toolId).length;
  };

  const isStale = (content: GeneratedContent): boolean => {
    if (!course?.syllabusUploadedAt) return false;
    return new Date(content.createdAt) < new Date(course.syllabusUploadedAt);
  };

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
                  <Wrench className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">{course.courseName}</h1>
                  <p className="text-sm text-muted-foreground">{course.courseNumber} · {course.semester} · {course.instructor}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/course/${courseId}/edit`)}
                data-testid="button-edit-course"
              >
                <Pencil className="w-4 h-4 mr-1.5" />
                Edit Course Info
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={generatedContents.length === 0 ? 0 : undefined}
                    aria-label={generatedContents.length === 0 ? "Export — no materials yet" : undefined}
                    style={{ display: "inline-flex" }}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openExportModal(generatedContents)}
                      disabled={generatedContents.length === 0 || isExporting}
                      aria-label="Choose course materials to export as a ZIP file"
                      data-testid="button-export-all"
                      style={generatedContents.length === 0 ? { pointerEvents: "none" } : undefined}
                    >
                      {isExporting ? (
                        <Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Download className="w-4 h-4 mr-1.5" aria-hidden="true" />
                      )}
                      {isExporting ? "Preparing…" : "Export"}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {generatedContents.length === 0
                    ? "Generate some course materials first to enable export."
                    : "Choose which materials to download as a ZIP of .docx files"}
                </TooltipContent>
              </Tooltip>
              <HeaderControls variant="light" showHome={true} />
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-2">Select a Design Tool</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-muted-foreground">
              Choose a tool to create or enhance course materials for your class
            </p>
            {toolUsageData && (
              <span
                className="text-sm font-medium text-muted-foreground bg-muted px-3 py-1 rounded-full"
                data-testid="text-tool-usage-summary"
                aria-live="polite"
              >
                {TOOLS.filter(t => usedToolSet.has(t.id)).length} of {TOOLS.length} tools used
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool, index) => {
            const Icon = iconMap[tool.icon];
            const bgColor = colorMap[tool.color];
            const contentCount = getContentCount(tool.id);
            const isUsed = usedToolSet.has(tool.id);

            return (
              <Card
                key={tool.id}
                className="group cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg animate-fade-in-up"
                style={{ animationDelay: `${index * 50}ms` }}
                onClick={() => navigate(`/course/${courseId}/tool/${tool.id}`)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/course/${courseId}/tool/${tool.id}`); } }}
                tabIndex={0}
                role="button"
                data-testid={`card-tool-${tool.id}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className={`w-12 h-12 rounded-xl ${bgColor} flex items-center justify-center text-white group-hover:scale-110 transition-transform`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <div className="flex items-center gap-2">
                      {isUsed ? (
                        <Badge
                          className="flex items-center gap-1 bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-green-200 dark:border-green-800 text-xs font-medium"
                          data-testid={`badge-completed-${tool.id}`}
                          aria-label="Completed"
                        >
                          <CheckCircle className="w-3 h-3" aria-hidden="true" />
                          Completed
                        </Badge>
                      ) : toolUsageData ? (
                        <span
                          className="text-xs text-muted-foreground"
                          data-testid={`text-not-started-${tool.id}`}
                        >
                          Not started
                        </span>
                      ) : null}
                      {contentCount > 0 && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
                          <FolderOpen className="w-3 h-3" />
                          {contentCount} saved
                        </div>
                      )}
                    </div>
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

        {generatedContents.filter(c => c.isApproved).length > 0 && (
          <div className="mt-12">
            <div className="flex items-center gap-2 mb-4">
              <Link2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h3 className="text-xl font-bold">Connected Course Materials</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              These materials will inform other tools when generating new content for this course.
            </p>
            <div className="space-y-3">
              {generatedContents.filter(c => c.isApproved).map((content) => {
                const tool = TOOLS.find(t => t.id === content.toolType);
                const Icon = tool ? iconMap[tool.icon] : FileText;
                const stale = isStale(content);
                
                return (
                  <Card
                    key={content.id}
                    className="cursor-pointer hover-elevate active-elevate-2 border-blue-200 dark:border-blue-800"
                    onClick={() => navigate(`/course/${courseId}/result/${content.id}`)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/course/${courseId}/result/${content.id}`); } }}
                    tabIndex={0}
                    role="button"
                    data-testid={`card-connected-${content.id}`}
                  >
                    <CardContent className="flex items-center gap-4 p-4">
                      <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium truncate">{content.toolName}</p>
                          {stale && (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 flex-shrink-0"
                              title="This was generated before your latest syllabus upload. Consider regenerating."
                              aria-label="Outdated: This was generated before your latest syllabus upload. Consider regenerating."
                              data-testid={`badge-outdated-${content.id}`}
                            >
                              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                              Outdated
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Created {new Date(content.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Link2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {generatedContents.length > 0 && (
          <div className="mt-12">
            <h3 className="text-xl font-bold mb-4">Previously Generated Content</h3>
            <div className="space-y-3">
              {generatedContents.slice(0, 5).map((content) => {
                const tool = TOOLS.find(t => t.id === content.toolType);
                const Icon = tool ? iconMap[tool.icon] : FileText;
                const stale = isStale(content);
                
                return (
                  <Card
                    key={content.id}
                    className="cursor-pointer hover-elevate active-elevate-2"
                    onClick={() => navigate(`/course/${courseId}/result/${content.id}`)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/course/${courseId}/result/${content.id}`); } }}
                    tabIndex={0}
                    role="button"
                    data-testid={`card-content-${content.id}`}
                  >
                    <CardContent className="flex items-center gap-4 p-4">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium truncate">{content.toolName}</p>
                          {content.isApproved && (
                            <Link2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                          )}
                          {stale && (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 flex-shrink-0"
                              title="This was generated before your latest syllabus upload. Consider regenerating."
                              aria-label="Outdated: This was generated before your latest syllabus upload. Consider regenerating."
                              data-testid={`badge-outdated-${content.id}`}
                            >
                              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                              Outdated
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Created {new Date(content.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-12 pt-8 border-t">
          <div className="flex flex-wrap justify-center gap-4">
            <Button
              variant="outline"
              onClick={() => navigate(`/help?from=/course/${courseId}/tools`)}
              data-testid="button-help"
            >
              <HelpCircle className="w-4 h-4 mr-2" />
              Help & Tips
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate(`/research?from=/course/${courseId}/tools`)}
              data-testid="button-research"
            >
              <GraduationCap className="w-4 h-4 mr-2" />
              Research & Theory
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate(`/library?from=/course/${courseId}/tools`)}
              data-testid="button-library"
            >
              <Library className="w-4 h-4 mr-2" />
              Content Library
            </Button>
          </div>
        </div>
      </div>
      <PoweredByFooter />

      <Dialog open={exportModalOpen} onOpenChange={setExportModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose materials to export</DialogTitle>
            <DialogDescription>
              Select the materials you want to include in the ZIP download. All items are selected by default.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-2 max-h-80 overflow-y-auto pr-1" role="group" aria-label="Materials to export">
            {generatedContents.map((content) => {
              const tool = TOOLS.find(t => t.id === content.toolType);
              const Icon = tool ? iconMap[tool.icon] : FileText;
              const checked = selectedIds.has(content.id);
              return (
                <label
                  key={content.id}
                  className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  data-testid={`export-item-${content.id}`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleId(content.id)}
                    id={`export-check-${content.id}`}
                    data-testid={`checkbox-export-${content.id}`}
                    aria-label={`Include ${content.toolName}`}
                  />
                  <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4 h-4 text-primary" aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{content.toolName}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(content.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-2 border-t text-sm text-muted-foreground">
            <span data-testid="text-selected-count">
              {selectedIds.size} of {generatedContents.length} selected
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground transition-colors"
                onClick={() => setSelectedIds(new Set(generatedContents.map(c => c.id)))}
                data-testid="button-select-all"
              >
                Select all
              </button>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground transition-colors"
                onClick={() => setSelectedIds(new Set())}
                data-testid="button-deselect-all"
              >
                Deselect all
              </button>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setExportModalOpen(false)}
              data-testid="button-cancel-export"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDownloadSelected}
              disabled={selectedIds.size === 0}
              data-testid="button-download-selected"
              aria-label={selectedIds.size === 0 ? "Select at least one item to download" : `Download ${selectedIds.size} selected item${selectedIds.size === 1 ? "" : "s"}`}
            >
              <Download className="w-4 h-4 mr-1.5" aria-hidden="true" />
              Download selected ({selectedIds.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
