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
  ArrowRight,
  ListChecks
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SavedContent, Course } from "@shared/schema";
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
                        {item.toolType === "assignment" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 text-xs"
                            onClick={() => {
                              if (item.formData && typeof item.formData === "object") {
                                sessionStorage.setItem("bsu-chain-prefill", JSON.stringify({
                                  targetToolId: "assignment",
                                  fields: item.formData,
                                  sourceName: item.title,
                                }));
                              }
                              sessionStorage.setItem("bsu-generate-rubric", "true");
                              const dest = item.courseId
                                ? `/course/${item.courseId}/tool/assignment`
                                : "/quick-tools/assignment";
                              navigate(dest);
                            }}
                            aria-label="Generate matching rubric for this assignment"
                            data-testid={`button-generate-rubric-${item.id}`}
                          >
                            <ListChecks className="w-3.5 h-3.5" />
                            Generate matching rubric
                          </Button>
                        )}
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
