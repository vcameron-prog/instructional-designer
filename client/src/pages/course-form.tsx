import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ArrowLeft, ArrowRight, Upload, FileText, Loader2 } from "lucide-react";
import { COURSE_LEVELS, CREDIT_OPTIONS, SEMESTERS } from "@/lib/constants";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Course } from "@shared/schema";

const courseFormSchema = z.object({
  courseName: z.string().min(1, "Course name is required"),
  courseNumber: z.string().min(1, "Course number is required"),
  courseLevel: z.string().min(1, "Course level is required"),
  credits: z.string().min(1, "Credits are required"),
  semester: z.string().min(1, "Semester is required"),
  instructor: z.string().min(1, "Instructor name is required"),
  department: z.string().min(1, "Department is required"),
  courseDescription: z.string().min(10, "Please provide a course description"),
  learningOutcomes: z.string().min(10, "Please provide learning outcomes"),
  prerequisites: z.string().optional(),
  existingSyllabus: z.string().optional(),
  additionalContext: z.string().optional(),
});

type CourseFormData = z.infer<typeof courseFormSchema>;

export default function CourseForm({ courseId }: { courseId?: number }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const { data: existingCourse, isLoading: isLoadingCourse } = useQuery<Course>({
    queryKey: ["/api/courses", courseId],
    enabled: !!courseId,
  });

  const form = useForm<CourseFormData>({
    resolver: zodResolver(courseFormSchema),
    defaultValues: {
      courseName: "",
      courseNumber: "",
      courseLevel: "",
      credits: "",
      semester: "",
      instructor: "",
      department: "",
      courseDescription: "",
      learningOutcomes: "",
      prerequisites: "",
      existingSyllabus: "",
      additionalContext: "",
    },
    values: existingCourse ? {
      courseName: existingCourse.courseName,
      courseNumber: existingCourse.courseNumber,
      courseLevel: existingCourse.courseLevel,
      credits: existingCourse.credits,
      semester: existingCourse.semester,
      instructor: existingCourse.instructor,
      department: existingCourse.department,
      courseDescription: existingCourse.courseDescription,
      learningOutcomes: existingCourse.learningOutcomes,
      prerequisites: existingCourse.prerequisites || "",
      existingSyllabus: existingCourse.existingSyllabus || "",
      additionalContext: existingCourse.additionalContext || "",
    } : undefined,
  });

  const createMutation = useMutation({
    mutationFn: async (data: CourseFormData) => {
      const response = await apiRequest("POST", "/api/courses", data);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      toast({ title: "Course created successfully!" });
      navigate(`/course/${data.id}/tools`);
    },
    onError: () => {
      toast({ title: "Failed to create course", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: CourseFormData) => {
      const response = await apiRequest("PATCH", `/api/courses/${courseId}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      toast({ title: "Course updated successfully!" });
      navigate(`/course/${courseId}/tools`);
    },
    onError: () => {
      toast({ title: "Failed to update course", variant: "destructive" });
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadedFileName(file.name);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload-syllabus", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Upload failed");

      const { content } = await response.json();
      form.setValue("existingSyllabus", content);
      toast({ title: "Syllabus uploaded successfully!" });
    } catch {
      toast({ title: "Failed to upload file", variant: "destructive" });
      setUploadedFileName("");
    } finally {
      setIsUploading(false);
    }
  };

  const onSubmit = (data: CourseFormData) => {
    if (courseId) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  if (courseId && isLoadingCourse) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-primary text-white py-6">
        <div className="container mx-auto px-4">
          <Button
            variant="ghost"
            className="text-white hover:bg-white/10 mb-4"
            onClick={() => navigate("/")}
            data-testid="button-back-home"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
          <h1 className="text-3xl font-bold">
            {courseId ? "Edit Course Information" : "Course Information"}
          </h1>
          <p className="text-white/80 mt-2">
            Provide details about your course to help generate tailored materials
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 max-w-4xl mx-auto">
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
                <CardDescription>Enter your course details</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="courseName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Course Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Introduction to Psychology" {...field} data-testid="input-course-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="courseNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Course Number *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., PSYC 101" {...field} data-testid="input-course-number" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="courseLevel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Course Level *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-course-level">
                            <SelectValue placeholder="Select level" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {COURSE_LEVELS.map(level => (
                            <SelectItem key={level} value={level}>{level}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="credits"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Credit Hours *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-credits">
                            <SelectValue placeholder="Select credits" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CREDIT_OPTIONS.map(credit => (
                            <SelectItem key={credit} value={credit}>{credit}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="semester"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Semester *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-semester">
                            <SelectValue placeholder="Select semester" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SEMESTERS.map(sem => (
                            <SelectItem key={sem} value={sem}>{sem}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="instructor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Instructor Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Your name" {...field} data-testid="input-instructor" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="department"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Department *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Psychology" {...field} data-testid="input-department" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="prerequisites"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prerequisites (optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., PSYC 100 or instructor permission" {...field} data-testid="input-prerequisites" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Course Content</CardTitle>
                <CardDescription>Describe your course in detail</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="courseDescription"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Course Description *</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Provide a comprehensive description of the course content and goals..."
                          className="min-h-32"
                          {...field}
                          data-testid="textarea-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="learningOutcomes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary Learning Outcomes *</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="List the main learning outcomes students should achieve..."
                          className="min-h-32"
                          {...field}
                          data-testid="textarea-outcomes"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="additionalContext"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Additional Course Context (optional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Any other important information about your course..."
                          className="min-h-24"
                          {...field}
                          data-testid="textarea-context"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Existing Syllabus (Optional)</CardTitle>
                <CardDescription>
                  Upload or paste your current syllabus to help maintain consistency
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="syllabus-upload" className="block mb-2">Upload Syllabus</Label>
                  <div className="flex items-center gap-4">
                    <label
                      htmlFor="syllabus-upload"
                      className="flex items-center gap-2 px-4 py-2 border border-dashed rounded-lg cursor-pointer hover:bg-muted transition-colors"
                    >
                      {isUploading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      <span>{uploadedFileName || "Choose PDF, Word, or Text file"}</span>
                      <input
                        id="syllabus-upload"
                        type="file"
                        accept=".pdf,.doc,.docx,.txt"
                        className="hidden"
                        onChange={handleFileUpload}
                        disabled={isUploading}
                        data-testid="input-file-upload"
                      />
                    </label>
                    {uploadedFileName && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <FileText className="w-4 h-4" />
                        {uploadedFileName}
                      </div>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or paste content</span>
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="existingSyllabus"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea
                          placeholder="Paste your current syllabus content here..."
                          className="min-h-40"
                          {...field}
                          data-testid="textarea-syllabus"
                        />
                      </FormControl>
                      <FormDescription>
                        This helps all tools generate materials that align with your course structure
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <div className="flex justify-end gap-4">
              <Button type="button" variant="outline" onClick={() => navigate("/")} data-testid="button-cancel">
                Cancel
              </Button>
              <Button type="submit" disabled={isPending} className="gap-2" data-testid="button-submit">
                {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {courseId ? "Save Changes" : "Continue to Tools"}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
