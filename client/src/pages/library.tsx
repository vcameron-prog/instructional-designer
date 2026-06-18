import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/hooks/use-auth";
import { CourseCard } from "@/components/course-card";
import { 
  ArrowLeft, 
  Library, 
  FileText, 
  BookOpen, 
  Calendar, 
  CheckCircle, 
  Layout, 
  Sparkles, 
  Target,
  Trash2,
  Copy,
  Download,
  FolderOpen,
  ArrowRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SavedContent, Course, Conversion } from "@shared/schema";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isSessionExpiredMessage } from "@/lib/upload-error-utils";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

const iconMap: Record<string, any> = {
  syllabus: BookOpen,
  schedule: Calendar,
  assignment: FileText,
  module: Layout,
  rubric: CheckCircle,
  aipolicy: Sparkles,
  alignment: Target,
};

export default function LibraryPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const searchParams = new URLSearchParams(window.location.search);
  const fromPath = searchParams.get("from");

  const handleBack = () => {
    navigate(fromPath || "/");
  };

  const { data: library = [], isLoading } = useQuery<SavedContent[]>({
    queryKey: ["/api/library"],
  });

  const { data: courses = [], isLoading: isCoursesLoading } = useQuery<Course[]>({
    queryKey: ["/api/courses"],
    enabled: isAuthenticated,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/library/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library"] });
      toast({ title: "Removed from library" });
    },
    onError: (error: Error) => {
      if (isSessionExpiredMessage(error.message)) return;
      toast({ title: "Failed to remove from library", variant: "destructive" });
    },
  });

  const { data: conversions = [], isLoading: isConversionsLoading } = useQuery<Conversion[]>({
    queryKey: ["/api/conversions"],
    enabled: isAuthenticated,
  });

  const deleteConversionMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/conversions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversions"] });
      toast({ title: "Conversion deleted" });
    },
    onError: (error: Error) => {
      if (isSessionExpiredMessage(error.message)) return;
      toast({ title: "Failed to delete conversion", variant: "destructive" });
    },
  });

  const deleteCourseMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/courses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      toast({ title: "Course deleted" });
    },
    onError: (error: Error) => {
      if (isSessionExpiredMessage(error.message)) return;
      toast({ title: "Failed to delete course", variant: "destructive" });
    },
  });

  const duplicateCourseMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/courses/${id}/duplicate`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      toast({ title: "Course duplicated", description: `Created "${data.courseName}"` });
    },
    onError: (error: Error) => {
      if (isSessionExpiredMessage(error.message)) return;
      toast({ title: "Failed to duplicate course", variant: "destructive" });
    },
  });

  const rolloverCourseMutation = useMutation({
    mutationFn: async ({ id, semester, contentIds }: { id: number; semester: string; contentIds: number[] }) => {
      const res = await apiRequest("POST", `/api/courses/${id}/rollover`, { semester, contentIds });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      navigate(`/course/${data.id}/tools`);
      toast({ title: "New semester created", description: `${data.courseName} — ${data.semester}` });
    },
    onError: () => {
      toast({ title: "Failed to create new semester course", variant: "destructive" });
    },
  });

  const copyToClipboard = async (content: string) => {
    await navigator.clipboard.writeText(content);
    toast({ title: "Copied to clipboard" });
  };

  const downloadContent = (content: string, title: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]/gi, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  usePageTitle("Content Library");

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
                  <Library className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">Content Library</h1>
                  <p className="text-sm text-muted-foreground">Saved templates you can reuse across any course</p>
                </div>
              </div>
            </div>
            <HeaderControls variant="light" showLibrary={false} showHome={true} />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {isAuthenticated && (isCoursesLoading || courses.length > 0) && (
          <Card className="bg-card border mb-8" data-testid="section-your-courses">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <FolderOpen className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">Your Courses</CardTitle>
                  <CardDescription>Resume or duplicate existing courses</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 max-h-96 overflow-y-auto">
              {isCoursesLoading ? (
                <div className="space-y-2">
                  {[1, 2].map(i => (
                    <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : (
                courses.map((course) => (
                  <CourseCard
                    key={course.id}
                    course={course}
                    onNavigate={() => navigate(`/course/${course.id}/tools`)}
                    onDuplicate={() => duplicateCourseMutation.mutate(course.id)}
                    onDelete={() => deleteCourseMutation.mutate(course.id)}
                    onRollover={(semester, contentIds) => rolloverCourseMutation.mutate({ id: course.id, semester, contentIds })}
                    isDuplicating={duplicateCourseMutation.isPending}
                    isRollingOver={rolloverCourseMutation.isPending}
                  />
                ))
              )}
            </CardContent>
          </Card>
        )}

        {isAuthenticated && (isConversionsLoading || conversions.length > 0) && (
          <Card className="bg-card border mb-8" data-testid="section-conversion-history">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">Conversion History</CardTitle>
                  <CardDescription>{conversions.length} document{conversions.length !== 1 ? "s" : ""} converted</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 max-h-96 overflow-y-auto">
              {isConversionsLoading ? (
                <div className="space-y-2">
                  {[1, 2].map(i => (
                    <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : (
                conversions.map((conv) => (
                  <div
                    key={conv.id}
                    className="flex items-center gap-4 p-3 rounded-lg hover:bg-muted/50 transition-all group"
                    data-testid={`card-conversion-${conv.id}`}
                  >
                    <button
                      onClick={() => navigate(`/pdf-accessibility/${conv.id}`)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                      data-testid={`link-conversion-${conv.id}`}
                    >
                      <FileText className="w-5 h-5 text-primary flex-shrink-0" aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate text-sm">{conv.originalFilename}</p>
                        <p className="text-xs text-muted-foreground">
                          {conv.sourceType && (
                            <span className="font-semibold mr-1">
                              {conv.sourceType === "google-doc"
                                ? "Google Doc"
                                : conv.sourceType === "google-sheet"
                                  ? "Google Sheet"
                                  : conv.sourceType === "docx"
                                    ? "DOCX"
                                    : conv.sourceType.toUpperCase()}
                            </span>
                          )}
                          {formatBytes(conv.fileSize)}
                          {conv.pageCount && ` · ${conv.pageCount} pages`}
                          {" · "}
                          {format(new Date(conv.createdAt), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0",
                          conv.status === "completed"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : conv.status === "processing"
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                              : conv.status === "failed"
                                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        )}
                        data-testid={`badge-status-${conv.id}`}
                      >
                        {conv.status === "completed"
                          ? `Accessible${(conv.complianceReport as Record<string, number> | null)?.overallScore != null ? ` (${(conv.complianceReport as Record<string, number>).overallScore}%)` : ""}`
                          : conv.status === "processing"
                            ? "Processing"
                            : conv.status === "failed"
                              ? "Failed"
                              : "Uploaded"}
                      </span>
                      <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" aria-hidden="true" />
                    </button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          className="text-muted-foreground hover:text-destructive transition-colors p-2 rounded-lg hover:bg-destructive/10 flex-shrink-0"
                          aria-label={`Delete ${conv.originalFilename}`}
                          data-testid={`button-delete-conversion-${conv.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete conversion?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete this conversion and its results.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteConversionMutation.mutate(conv.id)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : library.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Library className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Your content library is empty</h3>
              <p className="text-muted-foreground text-center max-w-md">
                Save generated content as templates to reuse across any course. 
                Look for the "Save as Template" button on any generated content.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {library.map((item) => {
              const Icon = iconMap[item.toolType] || FileText;
              return (
                <Card key={item.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold truncate">{item.title}</h3>
                        {item.description && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {item.description}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">
                          Saved {format(new Date(item.createdAt), "MMM d, yyyy")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => copyToClipboard(item.content)}
                          data-testid={`button-copy-${item.id}`}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => downloadContent(item.content, item.title)}
                          data-testid={`button-download-${item.id}`}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" data-testid={`button-delete-${item.id}`}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove template?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently remove this template from your library.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteMutation.mutate(item.id)}>
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      <PoweredByFooter />
    </main>
  );
}
