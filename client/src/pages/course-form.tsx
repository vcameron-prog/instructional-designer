import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { usePageTitle } from "@/hooks/use-page-title";
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
import { ArrowLeft, ArrowRight, Upload, FileText, Loader2, BookOpen } from "lucide-react";
import { COURSE_LEVELS, CREDIT_OPTIONS, SEMESTER_TYPES, getSemesterYears, buildSemesterString, parseSemesterString } from "@/lib/constants";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseSyllabusUploadError } from "@/lib/upload-error-utils";
import { useToast } from "@/hooks/use-toast";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { HeaderControls } from "@/components/header-controls";
import type { Course } from "@shared/schema";

const COURSE_TEMPLATES = [
  {
    id: "lecture",
    name: "Traditional Lecture Course",
    description: "Standard lecture-based course with exams and papers",
    defaults: {
      credits: "3",
      courseLevel: "Undergraduate",
      learningOutcomes: "Upon completion of this course, students will be able to:\n1. Demonstrate understanding of key concepts and theories\n2. Apply course concepts to real-world scenarios\n3. Analyze and evaluate relevant topics critically\n4. Communicate ideas effectively in written and oral formats",
    },
  },
  {
    id: "seminar",
    name: "Discussion Seminar",
    description: "Small, discussion-based classes focused on student participation and critical thinking",
    defaults: {
      credits: "3",
      courseLevel: "Graduate",
      learningOutcomes: "Upon completion of this course, students will be able to:\n1. Engage critically with primary source materials\n2. Lead and participate in scholarly discussions\n3. Develop and defend original arguments\n4. Synthesize diverse perspectives on complex topics",
    },
  },
  {
    id: "studio",
    name: "Studio Course",
    description: "Project-based, hands-on environment for art, design, music, or creative disciplines",
    defaults: {
      credits: "3",
      courseLevel: "Undergraduate",
      learningOutcomes: "Upon completion of this course, students will be able to:\n1. Apply creative techniques and processes to produce original work\n2. Critique and reflect on their own work and the work of peers\n3. Demonstrate proficiency with discipline-specific tools and materials\n4. Document and present creative projects professionally",
    },
  },
  {
    id: "lab",
    name: "Lab/Science Course",
    description: "Course with significant hands-on lab or fieldwork components",
    defaults: {
      credits: "4",
      courseLevel: "Undergraduate",
      learningOutcomes: "Upon completion of this course, students will be able to:\n1. Apply theoretical knowledge in practical settings\n2. Use equipment and tools safely and effectively\n3. Collect, analyze, and interpret data\n4. Document procedures and results professionally",
    },
  },
  {
    id: "independent",
    name: "Independent Study",
    description: "Tailored, individual projects directed by a faculty member",
    defaults: {
      credits: "3",
      courseLevel: "Undergraduate",
      learningOutcomes: "Upon completion of this course, students will be able to:\n1. Design and execute an independent research or creative project\n2. Demonstrate self-directed learning and time management\n3. Synthesize knowledge from prior coursework in a focused application\n4. Communicate project outcomes through written and oral presentations",
    },
  },
  {
    id: "capstone",
    name: "Capstone Course",
    description: "Culminating senior-level project representing cumulative learning in the major",
    defaults: {
      credits: "3",
      courseLevel: "Undergraduate",
      learningOutcomes: "Upon completion of this course, students will be able to:\n1. Integrate and apply knowledge and skills from across the major\n2. Complete a substantial project demonstrating professional-level competency\n3. Reflect critically on their academic and professional development\n4. Present and defend their work to faculty, peers, or external audiences",
    },
  },
  {
    id: "online",
    name: "Online Asynchronous",
    description: "Fully online self-paced course",
    defaults: {
      credits: "3",
      courseLevel: "Undergraduate",
      learningOutcomes: "Upon completion of this course, students will be able to:\n1. Demonstrate mastery of course content through varied assessments\n2. Manage time effectively in self-paced learning\n3. Engage meaningfully in online discussions and collaborations\n4. Apply course concepts independently",
    },
  },
  {
    id: "hybrid",
    name: "Hybrid Course",
    description: "Mix of in-person and online components",
    defaults: {
      credits: "3",
      courseLevel: "Undergraduate",
      learningOutcomes: "Upon completion of this course, students will be able to:\n1. Navigate effectively between online and in-person learning\n2. Demonstrate understanding through multiple modalities\n3. Collaborate with peers both virtually and in person\n4. Apply course concepts in varied contexts",
    },
  },
];

const courseFormSchema = z.object({
  courseName: z.string().min(1, "Course name is required"),
  courseNumber: z.string().min(1, "Course number is required"),
  sectionNumber: z.string().optional(),
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
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [semesterType, setSemesterType] = useState("");
  const [semesterYear, setSemesterYear] = useState("");
  useEffect(() => { window.scrollTo(0, 0); }, []);

  const { data: existingCourse, isLoading: isLoadingCourse } = useQuery<Course>({
    queryKey: ["/api/courses", courseId],
    enabled: !!courseId,
  });

  useEffect(() => {
    if (existingCourse?.semester) {
      const parsed = parseSemesterString(existingCourse.semester);
      setSemesterType(parsed.type);
      setSemesterYear(parsed.year);
    }
  }, [existingCourse]);

  const form = useForm<CourseFormData>({
    resolver: zodResolver(courseFormSchema),
    defaultValues: {
      courseName: "",
      courseNumber: "",
      sectionNumber: "",
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
      sectionNumber: existingCourse.sectionNumber || "",
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

      if (!response.ok) {
        const text = await response.text();
        throw parseSyllabusUploadError(response.status, text);
      }

      const { content } = await response.json();
      form.setValue("existingSyllabus", content);
      toast({ title: "Syllabus uploaded successfully!" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to upload file. Please try again.";
      toast({ title: message, variant: "destructive" });
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

  const applyTemplate = (templateId: string) => {
    const template = COURSE_TEMPLATES.find((t) => t.id === templateId);
    if (template) {
      setSelectedTemplate(templateId);
      form.setValue("credits", template.defaults.credits);
      form.setValue("courseLevel", template.defaults.courseLevel);
      form.setValue("learningOutcomes", template.defaults.learningOutcomes);
      toast({ title: `Applied ${template.name} template` });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  usePageTitle(courseId ? "Edit Course" : "New Course");

  if (courseId && isLoadingCourse) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-background flex items-center justify-center">
        <div role="status" aria-live="polite" className="flex items-center gap-2">
          <Loader2 className="w-8 h-8 animate-spin text-primary" aria-hidden="true" />
          <span className="sr-only">Loading course information</span>
        </div>
      </main>
    );
  }

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
                  <BookOpen className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">{courseId ? "Edit Course Information" : "Course Information"}</h1>
                  <p className="text-sm text-muted-foreground">Provide details about your course to help generate tailored materials</p>
                </div>
              </div>
            </div>
            <HeaderControls variant="light" showHome={true} />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 max-w-4xl mx-auto">
            {!courseId && (
              <Card className="bg-primary/5 border-primary/20">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-primary" />
                    <CardTitle className="text-lg">Quick Start with Templates</CardTitle>
                  </div>
                  <CardDescription>
                    Select a template to pre-fill common settings for your course type
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {COURSE_TEMPLATES.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => applyTemplate(template.id)}
                        className={`p-4 rounded-lg border text-left transition-colors hover-elevate ${
                          selectedTemplate === template.id
                            ? "border-primary bg-primary/10"
                            : "border-border bg-background"
                        }`}
                        data-testid={`button-template-${template.id}`}
                      >
                        <p className="font-medium text-sm">{template.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">{template.description}</p>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

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
                        <Input placeholder="e.g., Introduction to Psychology" {...field} aria-required="true" data-testid="input-course-name" />
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
                        <Input placeholder="e.g., PSYC 101" {...field} aria-required="true" data-testid="input-course-number" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="sectionNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Section Number</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., 01 or A" {...field} data-testid="input-section-number" />
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
                          <SelectTrigger data-testid="select-course-level" aria-required="true">
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
                          <SelectTrigger data-testid="select-credits" aria-required="true">
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
                      <div className="flex gap-2">
                        <Select
                          value={semesterType}
                          onValueChange={(val) => {
                            setSemesterType(val);
                            if (val && semesterYear) {
                              field.onChange(buildSemesterString(val, parseInt(semesterYear)));
                            }
                          }}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-semester-type" aria-required="true">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {SEMESTER_TYPES.map(type => (
                              <SelectItem key={type} value={type}>{type}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={semesterYear}
                          onValueChange={(val) => {
                            setSemesterYear(val);
                            if (semesterType && val) {
                              field.onChange(buildSemesterString(semesterType, parseInt(val)));
                            }
                          }}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-semester-year" aria-required="true">
                              <SelectValue placeholder="Year" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {getSemesterYears().map(year => (
                              <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
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
                        <Input placeholder="Your name" {...field} aria-required="true" data-testid="input-instructor" />
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
                        <Input placeholder="e.g., Psychology" {...field} aria-required="true" data-testid="input-department" />
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
                          aria-required="true"
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
                          aria-required="true"
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
      <PoweredByFooter />
    </main>
  );
}
