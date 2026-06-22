import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Loader2, Sparkles, BookOpen, Calendar, FileText, Layout, CheckCircle, Target, Scale, ShieldCheck, Eye, Bot, Globe, BookmarkPlus, ChevronDown, Trash2, SlidersHorizontal, Library, Info, X, Check } from "lucide-react";
import { TOOLS, BSU_CALENDAR, GENERATION_STEPS, BATCH_GENERATION_STEPS, COURSE_LEVELS, CONTENT_PREFILL_MAP, computeAiStepDuration, type GenerationStep } from "@/lib/constants";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isSessionExpiredMessage } from "@/lib/upload-error-utils";
import { pushFilterState } from "@/lib/nav-utils";
import { useToast } from "@/hooks/use-toast";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { LoadingScreen } from "@/components/loading-screen";
import { HeaderControls } from "@/components/header-controls";
import type { Course, GeneratedContent } from "@shared/schema";
import { UdlTips } from "@/components/udl-tips";
import { AccessibilityTips } from "@/components/accessibility-tips";
import { OutcomeLibraryModal } from "@/components/outcome-library-modal";
import { usePageTitle } from "@/hooks/use-page-title";
import { useQuickToolContext } from "@/hooks/use-quick-tool-context";
import { useToolPresets, PRESET_PREFILL_KEY } from "@/hooks/use-tool-presets";

interface ToolFormField {
  name: string;
  label: string;
  type: "text" | "textarea" | "select" | "checkbox-group" | "date" | "number";
  options?: string[];
  placeholder?: string;
  required?: boolean;
  helper?: string;
}

const getFormFields = (toolId: string): ToolFormField[] => {
  const fields: Record<string, ToolFormField[]> = {
    assignment: [
      { name: "assignmentType", label: "Assignment Type", type: "select", options: ["Essay/Paper", "Research Project", "Problem Set", "Lab Report", "Presentation", "Discussion", "Creative Project", "Case Study"], required: true },
      { name: "learningObjectives", label: "Key Learning Objectives", type: "textarea", placeholder: "What should students learn from this assignment?", required: true },
      { name: "duration", label: "Estimated Time to Complete", type: "select", options: ["1 hour (single class activity)", "2 hours", "3 hours", "4 hours", "5 hours", "1 week", "2 weeks", "3 weeks", "4 weeks", "Semester-long project"], required: true },
      { name: "inclusiveDesignOptions", label: "Inclusive Design Frameworks to Include", type: "checkbox-group", options: [
        "UDL (Universal Design for Learning)",
        "Cultural Relevance & Inclusivity",
        "SEL (Social-Emotional Learning)",
        "Accessibility Features",
        "AI-Powered Student Activities",
      ], helper: "Select which research-based frameworks to incorporate. Each framework adds specific guidance grounded in educational theory." },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any specific requirements, constraints, or preferences?" },
    ],
    rubric: [
      { name: "assessmentType", label: "What are you assessing?", type: "text", placeholder: "e.g., Research paper, presentation", required: true },
      { name: "totalPoints", label: "Total Points", type: "number", placeholder: "e.g., 100", required: true },
      { name: "criteria", label: "Key Evaluation Criteria", type: "textarea", placeholder: "What aspects should be evaluated?", required: true },
      { name: "levels", label: "Performance Levels", type: "select", options: ["3 levels", "4 levels", "5 levels"], required: true },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any specific requirements?" },
    ],
    module: [
      { name: "moduleTitle", label: "Module Title/Topic", type: "text", required: true },
      { name: "moduleDuration", label: "Module Duration", type: "select", options: ["1 week", "2 weeks", "3 weeks", "4 weeks"], required: true },
      { name: "learningOutcomes", label: "Learning Outcomes", type: "textarea", placeholder: "What should students be able to do after this module?", required: true },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any required readings, activities, or constraints?" },
    ],
    syllabus: [
      { name: "revisionGoals", label: "What would you like to enhance?", type: "checkbox-group", options: [
        "Add Universal Design for Learning (UDL) principles",
        "Incorporate cultural relevance and inclusivity",
        "Modernize pedagogy and teaching approaches",
        "Improve clarity and student-friendliness",
        "Add or revise assessment strategies",
        "Update course policies",
        "Enhance accessibility features",
      ], required: true },
      { name: "currentSyllabusText", label: "Current Syllabus Content", type: "textarea", placeholder: "Paste your current syllabus here (or add to what you provided in Course Info)...", helper: "If you already pasted your syllabus in the Course Info section, you can skip this or add additional content here." },
      { name: "specificConcerns", label: "Specific Areas of Concern", type: "textarea", placeholder: "Are there specific sections you want to focus on?" },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any other information?" },
    ],
    schedule: [
      { name: "startDate", label: "Course Start Date", type: "date", required: true },
      { name: "endDate", label: "Course End Date", type: "date", required: true },
      { name: "courseFormat", label: "Course Format", type: "select", options: ["Weekly (Traditional Semester)", "Bi-Weekly", "Module-Based", "Accelerated (8-week)"], required: true },
      { name: "numberOfWeeks", label: "Number of Weeks", type: "select", options: ["4", "5", "8", "10", "12", "14", "15", "16"], required: true },
      { name: "meetingPattern", label: "Meeting Pattern", type: "select", options: ["Once per week", "Twice per week", "Three times per week", "Online asynchronous", "Hybrid"], required: true },
      { name: "meetingDays", label: "Meeting Days (if applicable)", type: "text", placeholder: "e.g., Monday/Wednesday" },
      { name: "majorTopics", label: "Major Topics to Cover", type: "textarea", placeholder: "List the main topics or units...", required: true },
      { name: "assessments", label: "Major Assessments", type: "textarea", placeholder: "List key assessments and their timing...", required: true },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any other constraints?" },
    ],
    aipolicy: [
      { name: "aiStance", label: "Your General Stance on AI Use", type: "select", options: [
        "AI use prohibited entirely",
        "AI use prohibited for most work, allowed for specific tasks",
        "AI use allowed with restrictions and disclosure",
        "AI use encouraged as a learning tool",
        "Varies by assignment - need a matrix",
      ], required: true },
      { name: "aiTools", label: "Which AI Tools Are You Addressing?", type: "checkbox-group", options: [
        "ChatGPT / Claude / other chatbots",
        "AI writing assistants (Grammarly AI, etc.)",
        "AI image generators (DALL-E, Midjourney)",
        "AI coding assistants (GitHub Copilot)",
        "AI research tools (Elicit, Consensus)",
        "AI translation tools",
        "Other AI tools",
      ], required: true },
      { name: "keyAssignments", label: "Key Assignments to Address", type: "textarea", placeholder: "List your major assignments (e.g., research paper, presentations, problem sets, discussions)...", required: true },
      { name: "concerns", label: "Your Primary Concerns", type: "checkbox-group", options: [
        "Academic integrity",
        "Students missing learning opportunities",
        "Equity (not all students have equal access)",
        "Accuracy/hallucinations in AI output",
        "Students not developing critical skills",
        "Citation and plagiarism issues",
        "Preparing students for AI-enabled workplaces",
      ], required: true },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any specific situations or concerns you want addressed?" },
    ],
    alignment: [
      { name: "learningOutcomes", label: "Course Learning Outcomes", type: "textarea", placeholder: "List all your course learning outcomes (copy from syllabus or Course Info)...", required: true, helper: "Tip: Copy these from your syllabus for accuracy" },
      { name: "assignments", label: "Assignments and Assessments", type: "textarea", placeholder: 'List all assignments with brief descriptions (e.g., "Research Paper - 20% - Students analyze a historical event")...', required: true },
      { name: "checkType", label: "What Would You Like to Check?", type: "checkbox-group", options: [
        "Which outcomes each assignment addresses",
        "Gaps - outcomes not assessed by any assignment",
        "Overlaps - outcomes assessed multiple times",
        "Suggestions for better alignment",
        "Bloom's taxonomy level analysis",
      ], required: true },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any specific concerns about alignment?" },
    ],
    grading: [
      { name: "currentGradingApproach", label: "Current Grading Approach", type: "textarea", placeholder: "Describe your current grading system (categories, weights, late policies, etc.)...", helper: "Include any existing policies you want to reconsider or keep" },
      { name: "gradingPhilosophy", label: "Your Grading Philosophy Goals", type: "checkbox-group", options: [
        "Focus on content mastery over compliance",
        "Reduce impact of late penalties on final grades",
        "Allow revision and resubmission opportunities",
        "Use standards-based or specifications grading",
        "Eliminate or reduce participation/attendance grades",
        "Create more transparent grading criteria",
        "Reduce grade anxiety and promote learning",
      ], required: true },
      { name: "assessmentTypes", label: "Types of Assessments in Your Course", type: "checkbox-group", options: [
        "Exams/Quizzes",
        "Papers/Essays",
        "Projects",
        "Presentations",
        "Discussions/Participation",
        "Labs/Practicals",
        "Homework/Problem Sets",
        "Portfolios",
        "Reflections/Journals",
      ], required: true },
      { name: "challenges", label: "Current Grading Challenges", type: "checkbox-group", options: [
        "Students focus on points rather than learning",
        "Late work management is burdensome",
        "Grading feels subjective or inconsistent",
        "Participation grades seem unfair",
        "Students don't engage with feedback",
        "Grade distribution doesn't reflect learning",
        "Students with life challenges are penalized",
      ] },
      { name: "constraints", label: "Constraints to Consider", type: "textarea", placeholder: "Any departmental requirements, accreditation standards, or other constraints?" },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any other information about your course or students?" },
    ],
    airesistant: [
      { name: "existingAssignment", label: "Paste Your Current Assignment", type: "textarea", placeholder: "Copy and paste your existing assignment instructions here...", required: true, helper: "Include the full assignment prompt, instructions, and any rubric details" },
      { name: "assignmentType", label: "Assignment Type", type: "select", options: ["Essay/Paper", "Research Project", "Discussion Post", "Problem Set", "Lab Report", "Presentation", "Creative Project", "Case Study", "Exam/Quiz", "Other"], required: true },
      { name: "whatYouWant", label: "What Would You Like?", type: "checkbox-group", options: [
        "Vulnerability analysis - how easily can AI complete this?",
        "Specific enhancement recommendations",
        "Revised assignment with AI-resistant features",
        "Alternative assessment options",
        "Detection strategies for AI-generated work",
      ], required: true },
      { name: "constraints", label: "Constraints to Keep in Mind", type: "checkbox-group", options: [
        "Must remain a written assignment",
        "Limited class time available",
        "Large enrollment course",
        "Online/asynchronous delivery",
        "Students have varied access to technology",
        "Departmental requirements for format",
      ] },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any other information about your course, students, or concerns?" },
    ],
    accessibility: [
      { name: "contentToAnalyze", label: "Paste Your Assignment or Course Content", type: "textarea", placeholder: "Copy and paste the assignment instructions, syllabus section, or course materials you want to analyze for accessibility...", required: true, helper: "Include as much detail as possible for a comprehensive analysis" },
      { name: "contentType", label: "Content Type", type: "select", options: ["Assignment Instructions", "Syllabus Section", "Discussion Prompt", "Quiz/Exam", "Learning Module", "Course Materials/Readings", "Rubric", "Other"], required: true },
      { name: "analysisAreas", label: "Areas to Analyze", type: "checkbox-group", options: [
        "Document structure and readability",
        "Cognitive load and complexity",
        "Time and pacing considerations",
        "Alternative format options",
        "Assistive technology compatibility",
        "UDL alignment check",
        "Language clarity and simplicity",
      ], required: true },
      { name: "studentPopulation", label: "Student Population Considerations", type: "checkbox-group", options: [
        "Students with visual impairments",
        "Students with hearing impairments",
        "Students with learning disabilities",
        "English language learners",
        "Students with attention/executive function challenges",
        "Students with physical/motor disabilities",
        "Neurodiverse students",
      ], helper: "Select specific populations to tailor recommendations" },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any specific accessibility concerns or accommodations you're already aware of?" },
    ],
    aistudent: [
      { name: "activityType", label: "AI Activity Type", type: "select", options: [
        "AI Debate / Socratic Dialogue",
        "AI-Assisted Drafting & Revision",
        "AI as Research Assistant",
        "AI Code Review / Pair Programming",
        "AI-Generated Content Analysis",
        "AI Tutoring / Study Partner",
        "AI Data Analysis",
        "Custom AI Activity",
      ], required: true },
      { name: "learningObjectives", label: "Key Learning Objectives", type: "textarea", placeholder: "What should students learn from this activity?", required: true },
      { name: "aiToolRecommendation", label: "Recommended AI Tool", type: "select", options: [
        "Claude",
        "ChatGPT",
        "Any AI Assistant",
        "Multiple AI Tools (comparison activity)",
      ], required: true },
      { name: "studentLevel", label: "Student AI Experience Level", type: "select", options: [
        "Beginner (first time using AI)",
        "Intermediate (some AI experience)",
        "Advanced (regular AI users)",
      ], required: true },
      { name: "criticalThinkingFocus", label: "Critical Thinking Focus Areas", type: "checkbox-group", options: [
        "Evaluating AI output accuracy",
        "Identifying AI bias and limitations",
        "Comparing AI vs. human approaches",
        "Prompt engineering skills",
        "Ethical considerations of AI use",
      ], required: true, helper: "Select which critical thinking skills students should develop through this activity." },
      { name: "guardrails", label: "Activity Guardrails", type: "checkbox-group", options: [
        "Require AI interaction logs/screenshots",
        "Reflection component required",
        "Human revision required after AI use",
        "Peer review of AI-assisted work",
        "Citation of AI contributions",
      ], helper: "Select safeguards to ensure meaningful student engagement with the AI tool." },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any specific requirements, constraints, or preferences for the activity?" },
    ],
  };

  return fields[toolId] || [];
};

const toolIconMap: Record<string, any> = {
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

const LANGUAGE_OPTIONS = [
  { value: "English", label: "English" },
  { value: "Spanish", label: "Spanish (Español)" },
  { value: "French", label: "French (Français)" },
  { value: "Portuguese", label: "Portuguese (Português)" },
  { value: "Haitian Creole", label: "Haitian Creole (Kreyòl ayisyen)" },
];

const DEFAULT_LANGUAGE_KEY = "bsu-default-language";
const DEFAULT_OUTPUT_DETAIL_KEY = "bsu-default-output-detail";

function loadOutputDetail(): string {
  try {
    const val = localStorage.getItem(DEFAULT_OUTPUT_DETAIL_KEY);
    if (val === "concise" || val === "standard") return val;
  } catch {}
  return "concise";
}

function GenerationStepList({ steps, activeIndex }: { steps: GenerationStep[]; activeIndex: number }) {
  const listRef = useRef<HTMLOListElement>(null);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (listRef.current && minHeight === undefined) {
      setMinHeight(listRef.current.offsetHeight);
    }
  });

  return (
    <ol
      ref={listRef}
      style={minHeight !== undefined ? { minHeight } : undefined}
      className="text-left space-y-3 mb-6"
      role="status"
      aria-live="polite"
      aria-label="Generation progress"
    >
      {steps.map((step, i) => {
        const isDone = i < activeIndex;
        const isActive = i === activeIndex;
        return (
          <li
            key={step.label}
            aria-label={step.ariaLabel}
            className={`flex items-center gap-3 text-sm transition-opacity duration-300 ${isDone || isActive ? "opacity-100" : "opacity-40"}`}
          >
            <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
              {isDone ? (
                <Check className="w-4 h-4 text-green-600" aria-hidden="true" />
              ) : isActive ? (
                <Loader2 className="w-4 h-4 text-primary animate-spin" aria-hidden="true" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-muted-foreground/40 inline-block" aria-hidden="true" />
              )}
            </span>
            <span className={isDone ? "line-through text-muted-foreground" : isActive ? "font-medium text-foreground" : "text-muted-foreground"}>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function ToolForm() {
  const params = useParams();
  const courseId = params.id ? parseInt(params.id) : undefined;
  const toolId = params.toolId;
  const [location, navigate] = useLocation();
  const { toast } = useToast();

  const isStandalone = location.startsWith("/quick-tools");

  const { subject: savedSubject, courseLevel: savedCourseLevel, setSubject: persistSubject, setCourseLevel: persistCourseLevel, clearContext } = useQuickToolContext();

  const [chainSourceName, setChainSourceName] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>(() => {
    const savedDetail = loadOutputDetail();
    const raw = sessionStorage.getItem("bsu-chain-prefill");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { targetToolId: string; fields: Record<string, any>; sourceName?: string };
        sessionStorage.removeItem("bsu-chain-prefill");
        if (parsed.targetToolId === toolId && parsed.fields && typeof parsed.fields === "object") {
          if (parsed.sourceName) {
            setTimeout(() => setChainSourceName(parsed.sourceName!), 0);
          }
          return { outputDetail: savedDetail, ...parsed.fields };
        }
      } catch {
        sessionStorage.removeItem("bsu-chain-prefill");
      }
    }

    const presetRaw = sessionStorage.getItem(PRESET_PREFILL_KEY);
    if (presetRaw) {
      try {
        const parsed = JSON.parse(presetRaw) as { targetToolId: string; values: Record<string, any> };
        sessionStorage.removeItem(PRESET_PREFILL_KEY);
        if (parsed.targetToolId === toolId && parsed.values && typeof parsed.values === "object" && !Array.isArray(parsed.values)) {
          return parsed.values;
        }
      } catch {
        sessionStorage.removeItem(PRESET_PREFILL_KEY);
      }
    }

    if (!isStandalone) return { outputDetail: savedDetail };
    const urlParams = new URLSearchParams(window.location.search);
    const urlSubject = urlParams.get("subject") ?? "";
    const urlCourseLevel = urlParams.get("courseLevel") ?? "";
    return {
      outputDetail: savedDetail,
      subject: urlSubject || savedSubject,
      courseLevel: urlCourseLevel || savedCourseLevel,
    };
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outputDetailRef = useRef<string>(formData.outputDetail ?? "concise");
  outputDetailRef.current = formData.outputDetail ?? "concise";
  const [selectedPrefillId, setSelectedPrefillId] = useState<string>("");
  const [preFilledFields, setPreFilledFields] = useState<Set<string>>(new Set());
  const [language, setLanguage] = useState(
    () => localStorage.getItem(DEFAULT_LANGUAGE_KEY) || "English"
  );
  const [generateRubric, setGenerateRubric] = useState(() => {
    const flag = sessionStorage.getItem("bsu-generate-rubric");
    if (flag === "true") {
      sessionStorage.removeItem("bsu-generate-rubric");
      return true;
    }
    return false;
  });
  const [rubricTotalPoints, setRubricTotalPoints] = useState("100");
  const [rubricLevels, setRubricLevels] = useState("4 levels");

  const [outcomeLibraryOpen, setOutcomeLibraryOpen] = useState(false);
  const [outcomeLibraryField, setOutcomeLibraryField] = useState<string>("learningObjectives");

  const { presets, savePreset, deletePreset } = useToolPresets(isStandalone ? toolId : undefined);
  const [presetOpen, setPresetOpen] = useState(false);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const presetNameInputRef = useRef<HTMLInputElement>(null);

  const tool = TOOLS.find(t => t.id === toolId);

  usePageTitle(tool ? tool.name : "Tool");

  // Scroll to top when component mounts
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [toolId]);
  const formFields = getFormFields(toolId || "");

  const { data: course } = useQuery<Course>({
    queryKey: ["/api/courses", courseId],
    enabled: !!courseId && !isStandalone,
  });

  const compatibleSourceTypes: string[] = [];
  const { data: priorItems = [] } = useQuery<GeneratedContent[]>({
    queryKey: ["/api/courses", courseId, "content", toolId],
    queryFn: async () => {
      const res = await fetch(`/api/courses/${courseId}/content`);
      if (!res.ok) return [];
      const all: GeneratedContent[] = await res.json();
      
      // Filter based on tool compatibility
      if (toolId === "rubric") return all.filter(i => i.toolType === "assignment");
      if (toolId === "alignment") return all.filter(i => i.toolType === "assignment" || i.toolType === "rubric");
      if (toolId === "airesistant") return all.filter(i => i.toolType === "assignment");
      return [];
    },
    enabled: !!courseId && !isStandalone && ["rubric", "alignment", "airesistant"].includes(toolId || ""),
  });

  // Auto-fill schedule dates when semester is known
  useEffect(() => {
    if (toolId === "schedule" && course?.semester && BSU_CALENDAR[course.semester]) {
      const calendar = BSU_CALENDAR[course.semester];
      setFormData(prev => {
        const filledStart = !prev.startDate && calendar.startDate;
        const filledEnd = !prev.endDate && calendar.endDate;
        if (filledStart || filledEnd) {
          setPreFilledFields(prev => {
            const next = new Set(prev);
            if (filledStart) next.add("startDate");
            if (filledEnd) next.add("endDate");
            return next;
          });
        }
        return {
          ...prev,
          startDate: prev.startDate || calendar.startDate,
          endDate: prev.endDate || calendar.endDate,
        };
      });
    }
  }, [toolId, course?.semester]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (toolId === "assignment" && generateRubric) {
        const response = await apiRequest("POST", "/api/generate-batch-assignment-rubric", {
          formData,
          rubricConfig: { totalPoints: rubricTotalPoints, levels: rubricLevels },
          language,
          courseId: isStandalone ? undefined : courseId,
        });
        return response.json();
      }
      if (isStandalone) {
        const response = await apiRequest("POST", "/api/generate-standalone", {
          toolId,
          toolName: tool?.name,
          formData,
          language,
        });
        return response.json();
      }
      const response = await apiRequest("POST", `/api/courses/${courseId}/generate`, {
        toolId,
        toolName: tool?.name,
        formData,
        language,
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (stepTimerRef.current) {
        clearTimeout(stepTimerRef.current);
        stepTimerRef.current = null;
      }
      const completedSteps = (toolId === "assignment" && generateRubric)
        ? BATCH_GENERATION_STEPS.length
        : GENERATION_STEPS.length;
      setActiveStepIndex(completedSteps);

      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        setIsGenerating(false);
        if (toolId === "assignment" && generateRubric && data.assignmentId && data.rubricId) {
          if (isStandalone) {
            queryClient.invalidateQueries({ queryKey: ["/api/content/recent-quick-tools"] });
            navigate(`/quick-tools/result-batch/${data.assignmentId}/${data.rubricId}`);
          } else {
            queryClient.invalidateQueries({ queryKey: ["/api/courses", courseId, "content"] });
            queryClient.invalidateQueries({ queryKey: ["/api/courses", courseId, "tool-usage"] });
            navigate(`/course/${courseId}/result-batch/${data.assignmentId}/${data.rubricId}`);
          }
          return;
        }
        if (isStandalone) {
          queryClient.invalidateQueries({ queryKey: ["/api/content/recent-quick-tools"] });
          if (data.id) {
            navigate(`/quick-tools/result/${data.id}`);
          } else {
            queryClient.setQueryData(["/api/standalone-content", "anon"], data);
            navigate(`/quick-tools/result/anon`);
          }
        } else {
          queryClient.invalidateQueries({ queryKey: ["/api/courses", courseId, "content"] });
          queryClient.invalidateQueries({ queryKey: ["/api/courses", courseId, "tool-usage"] });
          navigate(`/course/${courseId}/result/${data.id}`);
        }
      }, 600);
    },
    onError: (error) => {
      setIsGenerating(false);
      if (isSessionExpiredMessage(error.message)) return;
      toast({ title: "Generation failed", description: error.message, variant: "destructive" });
    },
  });

  const isBatchTool = toolId === "assignment" && generateRubric;
  const generationSteps = isBatchTool ? BATCH_GENERATION_STEPS : GENERATION_STEPS;

  useEffect(() => {
    if (!isGenerating) return;
    setActiveStepIndex(0);
    let current = 0;
    const steps = isBatchTool ? BATCH_GENERATION_STEPS : GENERATION_STEPS;
    const outputDetail = outputDetailRef.current;
    const effectiveDurations = steps.map(step =>
      computeAiStepDuration(step, outputDetail, isBatchTool)
    );

    const advance = () => {
      current += 1;
      if (current < steps.length) {
        setActiveStepIndex(current);
        stepTimerRef.current = setTimeout(advance, effectiveDurations[current]);
      } else {
        stepTimerRef.current = null;
      }
    };

    stepTimerRef.current = setTimeout(advance, effectiveDurations[0]);
    return () => {
      if (stepTimerRef.current) {
        clearTimeout(stepTimerRef.current);
        stepTimerRef.current = null;
      }
    };
  }, [isGenerating, isBatchTool]);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    };
  }, []);

  const handleInputChange = (name: string, value: any) => {
    setFormData(prev => {
      const next = { ...prev, [name]: value };
      if (isStandalone && (name === "subject" || name === "courseLevel")) {
        const urlParams = new URLSearchParams(window.location.search);
        const subject = name === "subject" ? value : (next.subject ?? "");
        const courseLevel = name === "courseLevel" ? value : (next.courseLevel ?? "");
        if (subject) {
          urlParams.set("subject", subject);
        } else {
          urlParams.delete("subject");
        }
        if (courseLevel) {
          urlParams.set("courseLevel", courseLevel);
        } else {
          urlParams.delete("courseLevel");
        }
        pushFilterState(urlParams);
      }
      return next;
    });
    setPreFilledFields(prev => { const next = new Set(prev); next.delete(name); return next; });
    if (isStandalone) {
      if (name === "subject") persistSubject(value);
      if (name === "courseLevel") persistCourseLevel(value);
    }
    if (name === "outputDetail") {
      try { localStorage.setItem(DEFAULT_OUTPUT_DETAIL_KEY, value); } catch {}
    }
  };

  const handleCheckboxChange = (name: string, option: string, checked: boolean) => {
    setFormData(prev => {
      const current = prev[name] || [];
      if (checked) {
        return { ...prev, [name]: [...current, option] };
      } else {
        return { ...prev, [name]: current.filter((o: string) => o !== option) };
      }
    });
    setPreFilledFields(prev => { const next = new Set(prev); next.delete(name); return next; });
  };

  const handlePrefillSelect = (itemId: string) => {
    setSelectedPrefillId(itemId);
    if (!itemId || !toolId) return;
    const item = priorItems.find(i => String(i.id) === itemId);
    if (!item) return;
    const fd = (item.formData as Record<string, any>) || {};
    let fields: Record<string, any> = {};

    if (toolId === "rubric" && item.toolType === "assignment") {
      fields = {
        assessmentType: fd.assignmentType || "",
        criteria: fd.learningObjectives || "",
      };
    } else if (toolId === "alignment" && item.toolType === "assignment") {
      fields = {
        learningOutcomes: fd.learningObjectives || "",
        assignments: item.content.slice(0, 800),
      };
    } else if (toolId === "alignment" && item.toolType === "rubric") {
      const rubricDesc = [
        fd.assessmentType ? `Assessment: ${fd.assessmentType}` : "",
        fd.criteria ? `Criteria: ${fd.criteria}` : "",
      ].filter(Boolean).join("\n");
      fields = { assignments: rubricDesc };
    } else if (toolId === "alignment" && item.toolType === "syllabus") {
      const syllabusContent = item.content || "";
      const outcomesSectionMatch = syllabusContent.match(
        /##?\s*(?:Course\s+)?Learning\s+Outcomes[\s\S]*?\n([\s\S]*?)(?:\n##|\n---|\n\*\*\*|$)/i
      );
      const extractedOutcomes = outcomesSectionMatch
        ? outcomesSectionMatch[1].trim()
        : (fd.learningOutcomes || syllabusContent.slice(0, 600).trim());
      fields = {
        learningOutcomes: extractedOutcomes,
      };
    } else if (toolId === "airesistant" && item.toolType === "assignment") {
      fields = {
        existingAssignment: item.content,
        assignmentType: fd.assignmentType || "",
      };
    } else if (toolId === "accessibility" && item.toolType === "assignment") {
      fields = {
        contentToAnalyze: item.content,
      };
    } else if (toolId === "module" && item.toolType === "assignment") {
      fields = {
        learningOutcomes: fd.learningObjectives || "",
      };
    } else if (toolId === "module" && item.toolType === "syllabus") {
      // Syllabus formData has no learningOutcomes field — extract from generated content
      const syllabusContent = item.content || "";
      const outcomesSectionMatch = syllabusContent.match(
        /##?\s*(?:Course\s+)?Learning\s+Outcomes[\s\S]*?\n([\s\S]*?)(?:\n##|\n---|\n\*\*\*|$)/i
      );
      const extractedOutcomes = outcomesSectionMatch
        ? outcomesSectionMatch[1].trim()
        : syllabusContent.slice(0, 600).trim();
      fields = {
        learningOutcomes: extractedOutcomes,
      };
    } else if (toolId === "aistudent" && item.toolType === "assignment") {
      fields = {
        learningObjectives: fd.learningObjectives || "",
      };
    }

    const nonEmptyFields = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== "" && v !== null && v !== undefined)
    );
    if (Object.keys(nonEmptyFields).length > 0) {
      setFormData(prev => ({ ...prev, ...nonEmptyFields }));
      setPreFilledFields(new Set(Object.keys(nonEmptyFields)));
      toast({ title: "Form pre-filled", description: "Fields have been populated from the selected item. Review and adjust as needed." });
    }
  };

  const hasFormValues = Object.values(formData).some(v =>
    v !== undefined && v !== "" && v !== null && !(Array.isArray(v) && v.length === 0)
  );

  const handleLoadPreset = (presetName: string) => {
    const preset = presets.find(p => p.name === presetName);
    if (preset) {
      const values = preset.values;
      if (typeof values !== "object" || values === null || Array.isArray(values)) {
        toast({ title: "Could not load preset: invalid data", variant: "destructive" });
        return;
      }
      const safe: Record<string, any> = {};
      for (const [k, v] of Object.entries(values)) {
        if (typeof k === "string") safe[k] = v;
      }
      setFormData(safe);
      setPresetOpen(false);
      toast({ title: `Preset "${preset.name}" loaded` });
    }
  };

  const handleSavePreset = () => {
    const trimmed = presetName.trim();
    if (!trimmed) {
      toast({ title: "Please enter a preset name", variant: "destructive" });
      presetNameInputRef.current?.focus();
      return;
    }
    savePreset(trimmed, formData);
    toast({ title: `Preset "${trimmed}" saved` });
    setPresetName("");
    setIsSavingPreset(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Basic validation
    for (const field of formFields) {
      if (field.required) {
        const value = formData[field.name];
        if (!value || (Array.isArray(value) && value.length === 0)) {
          toast({ title: `${field.label} is required`, variant: "destructive" });
          document.getElementById(field.name)?.focus();
          return;
        }
      }
    }

    setChainSourceName(null);
    setIsGenerating(true);
    generateMutation.mutate();
  };

  const backPath = isStandalone ? "/quick-tools" : `/course/${courseId}/tools`;

  if (!tool) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 flex items-center justify-center">
          <Card className="max-w-md">
            <CardContent className="p-6 text-center">
              <p className="text-muted-foreground">Tool not found</p>
              <Button className="mt-4" onClick={() => navigate(backPath)}>
                Return to Tools
              </Button>
            </CardContent>
          </Card>
        </div>
        <PoweredByFooter />
      </main>
    );
  }

  if (isGenerating) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen flex flex-col bg-gradient-to-br from-primary/5 to-accent/5">
        <div className="flex-1 flex items-center justify-center">
          <Card className="max-w-lg w-full mx-4">
            <CardContent className="p-12 text-center">
              <div className="w-20 h-20 mx-auto mb-8 relative">
                {activeStepIndex < generationSteps.length && (
                  <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
                )}
                <div className="relative w-full h-full bg-primary rounded-full flex items-center justify-center">
                  <Sparkles className={`w-10 h-10 text-white ${activeStepIndex < generationSteps.length ? "animate-pulse" : ""}`} aria-hidden="true" />
                </div>
              </div>
              <h2 className="text-2xl font-bold mb-4">Generating Your {tool.name}</h2>
              {activeStepIndex >= generationSteps.length ? (
                <p className="text-sm font-semibold mb-6 flex items-center justify-center gap-1.5 text-green-600" data-testid="text-generation-done">
                  <Check className="w-4 h-4" aria-hidden="true" />
                  All done!
                </p>
              ) : (
                <p className="text-sm font-medium mb-6 animate-pulse-subtle text-muted-foreground" data-testid="text-generation-step">
                  {generationSteps[activeStepIndex]?.label}
                </p>
              )}
              <GenerationStepList steps={generationSteps} activeIndex={activeStepIndex} />
              <div className="flex justify-center gap-1 h-2" aria-hidden="true">
                {activeStepIndex < generationSteps.length && [0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="w-2 h-2 bg-primary rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        <PoweredByFooter />
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
                onClick={() => navigate(backPath)}
                aria-label="Back to tools"
                data-testid="button-back-tools"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  {(() => { const ToolIcon = toolIconMap[tool.icon] || Sparkles; return <ToolIcon className="w-5 h-5 text-primary" />; })()}
                </div>
                <div>
                  <h1 className="text-xl font-bold">{tool.name}</h1>
                  <p className="text-sm text-muted-foreground">{tool.description}</p>
                </div>
              </div>
            </div>
            <HeaderControls variant="light" showHome={true} />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto space-y-6">
          {course && !isStandalone && (
            <Card className="bg-muted/30">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">
                  Creating for: <span className="font-medium text-foreground">{course.courseName}</span> ({course.courseNumber})
                </p>
              </CardContent>
            </Card>
          )}

          {isStandalone && presets.length > 0 && (
            <Card className="bg-muted/30">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-sm font-medium shrink-0">Saved Presets</Label>
                  <Popover open={presetOpen} onOpenChange={setPresetOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1 justify-between text-muted-foreground font-normal"
                        data-testid="button-open-presets"
                        aria-label="Load a saved preset"
                      >
                        <span>Load a preset…</span>
                        <ChevronDown className="w-4 h-4 ml-2 opacity-60" aria-hidden="true" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-1" align="end">
                      <ul role="listbox" aria-label="Saved presets">
                        {presets.map((preset) => (
                          <li
                            key={preset.name}
                            className="flex items-center gap-1 rounded-sm"
                            role="option"
                            aria-selected={false}
                          >
                            <button
                              type="button"
                              className="flex-1 text-left text-sm px-3 py-2 rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors truncate"
                              onClick={() => handleLoadPreset(preset.name)}
                              data-testid={`button-load-preset-${preset.name}`}
                            >
                              {preset.name}
                            </button>
                            <button
                              type="button"
                              className="p-2 rounded-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                deletePreset(preset.name);
                                toast({ title: `Preset "${preset.name}" deleted` });
                              }}
                              aria-label={`Delete preset "${preset.name}"`}
                              data-testid={`button-delete-preset-${preset.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </PopoverContent>
                  </Popover>
                </div>
              </CardContent>
            </Card>
          )}

          {isStandalone && (
            <Card className="bg-muted/30">
              <CardHeader className="pb-3 pt-4 px-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <CardTitle className="text-sm font-medium text-muted-foreground">Course Context (Optional)</CardTitle>
                    <CardDescription className="text-xs">Adding subject and level helps generate more tailored content</CardDescription>
                  </div>
                  {(formData.subject || formData.courseLevel) && (
                    <button
                      type="button"
                      onClick={() => {
                        clearContext();
                        setFormData(prev => ({ ...prev, subject: "", courseLevel: "" }));
                        const urlParams = new URLSearchParams(window.location.search);
                        urlParams.delete("subject");
                        urlParams.delete("courseLevel");
                        pushFilterState(urlParams);
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                      data-testid="button-clear-context"
                    >
                      Clear saved context
                    </button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0 grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="standalone-subject" className="text-sm">Subject / Department</Label>
                  <Input
                    id="standalone-subject"
                    placeholder="e.g., Psychology, Biology"
                    value={formData.subject || ""}
                    onChange={(e) => handleInputChange("subject", e.target.value)}
                    data-testid="input-standalone-subject"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="standalone-level" className="text-sm">Course Level</Label>
                  <Select
                    value={formData.courseLevel || ""}
                    onValueChange={(value) => handleInputChange("courseLevel", value)}
                  >
                    <SelectTrigger id="standalone-level" data-testid="select-standalone-level">
                      <SelectValue placeholder="Select level" />
                    </SelectTrigger>
                    <SelectContent>
                      {COURSE_LEVELS.map(level => (
                        <SelectItem key={level} value={level}>{level}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          )}

          {toolId && toolId !== "accessibility" && <UdlTips toolId={toolId} />}
          {toolId === "accessibility" && <AccessibilityTips />}

          {priorItems.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Pre-fill from a previous item</CardTitle>
                <CardDescription>
                  Select a previously generated item to populate this form automatically.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Select
                  value={selectedPrefillId}
                  onValueChange={handlePrefillSelect}
                >
                  <SelectTrigger data-testid="select-prefill-item">
                    <SelectValue placeholder="Choose a previous item…" />
                  </SelectTrigger>
                  <SelectContent>
                    {priorItems.map(item => (
                      <SelectItem key={item.id} value={String(item.id)} data-testid={`prefill-option-${item.id}`}>
                        {item.toolName} — {new Date(item.createdAt).toLocaleDateString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Tool Configuration</CardTitle>
              <CardDescription>Customize your {tool.name.toLowerCase()}</CardDescription>
            </CardHeader>
            {chainSourceName && (
              <div
                className="mx-6 mb-2 flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary"
                role="status"
                aria-live="polite"
                data-testid="banner-chain-prefill"
              >
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">
                  Pre-filled from your <strong>{chainSourceName}</strong> result — review and edit as needed.
                </span>
                <button
                  type="button"
                  onClick={() => setChainSourceName(null)}
                  className="shrink-0 rounded p-0.5 hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  aria-label="Dismiss pre-fill notice"
                  data-testid="button-dismiss-prefill-banner"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
            <CardContent className="space-y-6">
              {formFields.map((field) => {
                const isPrefilled = preFilledFields.has(field.name);
                return (
                <div
                  key={field.name}
                  className={`space-y-2 rounded-md transition-all duration-200 ${isPrefilled ? "pl-3 border-l-2 border-primary/60" : ""}`}
                  data-testid={isPrefilled ? `prefilled-field-${field.name}` : undefined}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={field.name}>
                        {field.label}
                        {field.required && <span className="text-destructive ml-1">*</span>}
                      </Label>
                      {isPrefilled && (
                        <span
                          className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20"
                          aria-label="This field was pre-filled automatically"
                          data-testid={`badge-prefilled-${field.name}`}
                        >
                          Pre-filled
                        </span>
                      )}
                    </div>
                    {field.type === "textarea" && (field.name === "learningObjectives" || field.name === "learningOutcomes") && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs h-7 shrink-0"
                        onClick={() => { setOutcomeLibraryField(field.name); setOutcomeLibraryOpen(true); }}
                        data-testid={`button-browse-outcome-library-${field.name}`}
                      >
                        <Library className="w-3.5 h-3.5" aria-hidden="true" />
                        Browse outcome library
                      </Button>
                    )}
                  </div>
                  
                  {field.type === "text" && (
                    <Input
                      id={field.name}
                      placeholder={field.placeholder}
                      value={formData[field.name] || ""}
                      onChange={(e) => handleInputChange(field.name, e.target.value)}
                      aria-required={field.required ? "true" : undefined}
                      data-testid={`input-${field.name}`}
                    />
                  )}

                  {field.type === "number" && (
                    <Input
                      id={field.name}
                      type="number"
                      placeholder={field.placeholder}
                      value={formData[field.name] || ""}
                      onChange={(e) => handleInputChange(field.name, e.target.value)}
                      aria-required={field.required ? "true" : undefined}
                      data-testid={`input-${field.name}`}
                    />
                  )}

                  {field.type === "date" && (
                    <Input
                      id={field.name}
                      type="date"
                      value={formData[field.name] || ""}
                      onChange={(e) => handleInputChange(field.name, e.target.value)}
                      aria-required={field.required ? "true" : undefined}
                      data-testid={`input-${field.name}`}
                    />
                  )}

                  {field.type === "textarea" && (
                    <Textarea
                      id={field.name}
                      placeholder={field.placeholder}
                      value={formData[field.name] || ""}
                      onChange={(e) => handleInputChange(field.name, e.target.value)}
                      className="min-h-28"
                      aria-required={field.required ? "true" : undefined}
                      data-testid={`textarea-${field.name}`}
                    />
                  )}

                  {field.type === "select" && field.options && (
                    <Select
                      value={formData[field.name] || ""}
                      onValueChange={(value) => handleInputChange(field.name, value)}
                    >
                      <SelectTrigger data-testid={`select-${field.name}`} aria-required={field.required ? "true" : undefined}>
                        <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options.map((option) => (
                          <SelectItem key={option} value={option}>{option}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {field.type === "checkbox-group" && field.options && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {field.options.map((option) => (
                        <div key={option} className="flex items-start gap-3">
                          <Checkbox
                            id={`${field.name}-${option}`}
                            checked={(formData[field.name] || []).includes(option)}
                            onCheckedChange={(checked) => handleCheckboxChange(field.name, option, !!checked)}
                            data-testid={`checkbox-${field.name}-${option.slice(0, 20)}`}
                          />
                          <Label
                            htmlFor={`${field.name}-${option}`}
                            className="text-sm font-normal leading-tight cursor-pointer"
                          >
                            {option}
                          </Label>
                        </div>
                      ))}
                    </div>
                  )}

                  {field.helper && (
                    <p className="text-sm text-muted-foreground">{field.helper}</p>
                  )}
                </div>
                );
              })}
            </CardContent>
          </Card>

          {toolId && !["syllabus", "aipolicy", "accessibility"].includes(toolId) && (
            <Card className="bg-muted/30">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <SlidersHorizontal className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <Label className="text-sm font-medium">Output Detail</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(formData.outputDetail || "concise") === "concise"
                        ? "Concise: focused output covering the essential sections — faster to read and act on."
                        : "Standard: comprehensive output with full inclusive design sections and resources."}
                    </p>
                  </div>
                  <div
                    className="flex rounded-md border overflow-hidden shrink-0"
                    role="group"
                    aria-label="Output detail level"
                  >
                    <button
                      type="button"
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${(formData.outputDetail || "concise") === "concise" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                      onClick={() => handleInputChange("outputDetail", "concise")}
                      aria-pressed={(formData.outputDetail || "concise") === "concise"}
                      data-testid="button-output-detail-concise"
                    >
                      Concise
                    </button>
                    <button
                      type="button"
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${(formData.outputDetail || "concise") === "standard" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                      onClick={() => handleInputChange("outputDetail", "standard")}
                      aria-pressed={(formData.outputDetail || "concise") === "standard"}
                      data-testid="button-output-detail-standard"
                    >
                      Standard
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Globe className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <Label htmlFor="output-language" className="text-sm font-medium">
                    Output Language
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Generate content in this language. Default set in Preferences.
                  </p>
                </div>
                <Select
                  value={language}
                  onValueChange={setLanguage}
                >
                  <SelectTrigger id="output-language" className="w-48" data-testid="select-output-language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {isStandalone && hasFormValues && (
            <div className="flex items-start gap-3">
              {!isSavingPreset ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 text-muted-foreground"
                  onClick={() => {
                    setIsSavingPreset(true);
                    setTimeout(() => presetNameInputRef.current?.focus(), 50);
                  }}
                  data-testid="button-save-preset-open"
                >
                  <BookmarkPlus className="w-4 h-4" aria-hidden="true" />
                  Save as preset
                </Button>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <Input
                    ref={presetNameInputRef}
                    placeholder="Preset name (e.g. COMM 201 Undergrad Essay)"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleSavePreset(); }
                      if (e.key === "Escape") { setIsSavingPreset(false); setPresetName(""); }
                    }}
                    className="w-72 h-9 text-sm"
                    aria-label="Preset name"
                    data-testid="input-preset-name"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSavePreset}
                    data-testid="button-save-preset-confirm"
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => { setIsSavingPreset(false); setPresetName(""); }}
                    data-testid="button-save-preset-cancel"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )}

          {toolId === "assignment" && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Also generate a matching rubric</CardTitle>
                    <CardDescription className="text-sm mt-1">
                      Generate a rubric whose criteria are directly derived from this assignment
                    </CardDescription>
                  </div>
                  <Switch
                    id="generate-rubric-toggle"
                    checked={generateRubric}
                    onCheckedChange={setGenerateRubric}
                    aria-label="Also generate a matching rubric"
                    data-testid="switch-generate-rubric"
                  />
                </div>
              </CardHeader>
              {generateRubric && (
                <CardContent className="space-y-4 pt-0">
                  <div className="space-y-2">
                    <Label htmlFor="rubric-total-points">
                      Total Points <span className="text-destructive ml-1">*</span>
                    </Label>
                    <Input
                      id="rubric-total-points"
                      type="number"
                      placeholder="e.g., 100"
                      value={rubricTotalPoints}
                      onChange={(e) => setRubricTotalPoints(e.target.value)}
                      aria-required="true"
                      data-testid="input-rubric-total-points"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rubric-levels">Performance Levels</Label>
                    <Select value={rubricLevels} onValueChange={setRubricLevels}>
                      <SelectTrigger id="rubric-levels" data-testid="select-rubric-levels">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="3 levels">3 levels</SelectItem>
                        <SelectItem value="4 levels">4 levels</SelectItem>
                        <SelectItem value="5 levels">5 levels</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          <div className="flex justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(backPath)}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button type="submit" className="gap-2" data-testid="button-generate">
              <Sparkles className="w-4 h-4" />
              {toolId === "assignment" && generateRubric
                ? "Generate Assignment & Rubric"
                : `Generate ${tool.name}`}
            </Button>
          </div>
        </form>
      </div>
      <PoweredByFooter />

      <OutcomeLibraryModal
        open={outcomeLibraryOpen}
        onClose={() => setOutcomeLibraryOpen(false)}
        onAddOutcomes={(texts) => {
          const current = (formData[outcomeLibraryField] as string) ?? "";
          const appended = texts.map((t) => `- ${t}`).join("\n");
          const next = current.trim() ? `${current.trim()}\n${appended}` : appended;
          handleInputChange(outcomeLibraryField, next);
          toast({ title: `${texts.length} outcome${texts.length !== 1 ? "s" : ""} added to ${outcomeLibraryField === "learningOutcomes" ? "Learning Outcomes" : "Learning Objectives"}` });
        }}
      />
    </main>
  );
}
