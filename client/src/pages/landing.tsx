import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { GraduationCap, Sparkles, FolderOpen, ArrowRight, Trash2 } from "lucide-react";
import type { Course } from "@shared/schema";
import { format } from "date-fns";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";

export default function LandingPage() {
  const [, navigate] = useLocation();

  const { data: courses = [], isLoading } = useQuery<Course[]>({
    queryKey: ["/api/courses"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/courses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
    },
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary via-primary/90 to-primary/80 relative overflow-hidden">
      <div className="absolute inset-0 pattern-dots text-white/10 opacity-50" />
      
      <div className="relative z-10 container mx-auto px-4 py-12 md:py-20">
        <div className="text-center mb-12 animate-fade-in-up">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-primary to-accent rounded-3xl mb-8 shadow-2xl">
            <GraduationCap className="w-14 h-14 text-white" />
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-4 tracking-tight">
            BSU Instructional Design Tool
          </h1>
          <p className="text-lg md:text-xl text-white/90 max-w-2xl mx-auto leading-relaxed">
            Create comprehensive, UDL-aligned course materials ready for Blackboard Ultra
          </p>
        </div>

        <div className={`grid gap-6 max-w-4xl mx-auto ${courses.length > 0 ? "md:grid-cols-2" : "max-w-md"}`}>
          <Card 
            className="group cursor-pointer transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl bg-white border-0"
            onClick={() => navigate("/new-course")}
            data-testid="card-new-course"
          >
            <CardContent className="p-8 text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent to-secondary flex items-center justify-center mx-auto mb-6 group-hover:scale-105 transition-transform">
                <Sparkles className="w-10 h-10 text-white" />
              </div>
              <CardTitle className="text-2xl mb-3">Start New Course</CardTitle>
              <CardDescription className="text-base">
                Begin with course information and create materials from scratch
              </CardDescription>
              <Button className="mt-6 gap-2" data-testid="button-start-new">
                Get Started <ArrowRight className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>

          {courses.length > 0 && (
            <Card className="bg-white border-0">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <FolderOpen className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Continue Previous</CardTitle>
                    <CardDescription>Resume working on a saved course</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 max-h-80 overflow-y-auto">
                {isLoading ? (
                  <div className="space-y-2">
                    {[1, 2].map(i => (
                      <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
                    ))}
                  </div>
                ) : (
                  courses.map((course) => (
                    <div
                      key={course.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors group"
                    >
                      <button
                        className="flex-1 text-left"
                        onClick={() => navigate(`/course/${course.id}/tools`)}
                        data-testid={`button-course-${course.id}`}
                      >
                        <p className="font-semibold text-foreground">{course.courseName}</p>
                        <p className="text-sm text-muted-foreground">
                          {course.courseNumber} • {course.semester}
                        </p>
                      </button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                            data-testid={`button-delete-course-${course.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Course?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete "{course.courseName}"? This will permanently remove all saved work and cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(course.id)}
                              className="bg-destructive hover:bg-destructive/90"
                            >
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
        </div>

        <div className="mt-16 text-center">
          <p className="text-white/70 text-sm">
            Powered by AI to help Bridgewater State University faculty create accessible, engaging course materials
          </p>
        </div>
      </div>
    </div>
  );
}
