export const COURSE_LEVELS = [
  "Undergraduate - 100 level",
  "Undergraduate - 200 level",
  "Undergraduate - 300 level",
  "Undergraduate - 400 level",
  "Graduate",
  "Continuing Education",
];

export const CREDIT_OPTIONS = ["0", "1", "2", "3", "4"];

export const SEMESTER_TYPES = [
  "Fall",
  "Spring",
  "Summer Session I",
  "Summer Session II",
] as const;

export function getSemesterYears(): number[] {
  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = currentYear - 1; y <= currentYear + 3; y++) {
    years.push(y);
  }
  return years;
}

export function buildSemesterString(type: string, year: number): string {
  if (type.startsWith("Summer")) {
    return `${type.replace("Summer ", "Summer " + year + " ")}`;
  }
  return `${type} ${year}`;
}

export function parseSemesterString(semester: string): { type: string; year: string } {
  const summerMatch = semester.match(/^(Summer)\s+(\d{4})\s+(Session\s+\w+)$/);
  if (summerMatch) {
    return { type: `Summer ${summerMatch[3]}`, year: summerMatch[2] };
  }
  const match = semester.match(/^(\w+)\s+(\d{4})$/);
  if (match) {
    return { type: match[1], year: match[2] };
  }
  return { type: "", year: "" };
}

export function getNextSemester(semester: string): { type: string; year: number } {
  const { type, year } = parseSemesterString(semester);
  const yearNum = parseInt(year) || new Date().getFullYear();

  switch (type) {
    case "Fall":
      return { type: "Spring", year: yearNum + 1 };
    case "Spring":
      return { type: "Fall", year: yearNum };
    case "Summer Session I":
      return { type: "Summer Session II", year: yearNum };
    case "Summer Session II":
      return { type: "Fall", year: yearNum };
    default:
      return { type: "Fall", year: yearNum };
  }
}

export const BSU_CALENDAR: Record<string, { startDate: string; endDate: string; breaks: { name: string; start: string; end: string }[] }> = {
  "Fall 2025": {
    startDate: "2025-09-03",
    endDate: "2025-12-10",
    breaks: [
      { name: "Columbus Day/Indigenous Peoples Day", start: "2025-10-13", end: "2025-10-13" },
      { name: "Veterans Day", start: "2025-11-11", end: "2025-11-11" },
      { name: "Thanksgiving Recess", start: "2025-11-26", end: "2025-11-30" },
    ],
  },
  "Spring 2026": {
    startDate: "2026-01-21",
    endDate: "2026-05-04",
    breaks: [
      { name: "Presidents Day", start: "2026-02-16", end: "2026-02-16" },
      { name: "Spring Break", start: "2026-03-09", end: "2026-03-13" },
      { name: "Patriots Day", start: "2026-04-20", end: "2026-04-20" },
    ],
  },
  "Summer 2026 Session I": {
    startDate: "2026-05-26",
    endDate: "2026-06-29",
    breaks: [{ name: "Juneteenth", start: "2026-06-19", end: "2026-06-19" }],
  },
  "Summer 2026 Session II": {
    startDate: "2026-07-13",
    endDate: "2026-08-14",
    breaks: [],
  },
  "Fall 2026": {
    startDate: "2026-09-02",
    endDate: "2026-12-10",
    breaks: [
      { name: "Labor Day", start: "2026-09-07", end: "2026-09-07" },
      { name: "Columbus Day/Indigenous Peoples Day", start: "2026-10-12", end: "2026-10-12" },
      { name: "Veterans Day", start: "2026-11-11", end: "2026-11-11" },
      { name: "Thanksgiving Recess", start: "2026-11-25", end: "2026-11-30" },
    ],
  },
  "Spring 2027": {
    startDate: "2027-01-20",
    endDate: "2027-05-03",
    breaks: [
      { name: "Presidents Day", start: "2027-02-15", end: "2027-02-15" },
      { name: "Spring Break", start: "2027-03-08", end: "2027-03-12" },
      { name: "Patriots Day", start: "2027-04-19", end: "2027-04-19" },
    ],
  },
  "Summer 2027 Session I": {
    startDate: "2027-05-24",
    endDate: "2027-06-28",
    breaks: [
      { name: "Memorial Day", start: "2027-05-31", end: "2027-05-31" },
      { name: "Juneteenth", start: "2027-06-18", end: "2027-06-18" },
    ],
  },
  "Summer 2027 Session II": {
    startDate: "2027-07-12",
    endDate: "2027-08-13",
    breaks: [],
  },
};

export interface ToolChain {
  targetId: string;
  label: string;
}

export const TOOLS: {
  id: string;
  name: string;
  icon: string;
  description: string;
  color: string;
  chains?: ToolChain[];
}[] = [
  {
    id: "syllabus",
    name: "Syllabus Editor",
    icon: "BookOpen",
    description: "Enhance and revise your syllabus with UDL, cultural relevance, and modern pedagogy",
    color: "primary",
  },
  {
    id: "schedule",
    name: "Course Schedule Designer",
    icon: "Calendar",
    description: "Create detailed week-by-week course timelines with actual dates",
    color: "primary",
  },
  {
    id: "assignment",
    name: "Assignment Design",
    icon: "FileText",
    description: "Create comprehensive, UDL-aligned assignments ready for Blackboard Ultra",
    color: "primary",
    chains: [
      { targetId: "rubric", label: "Build a rubric for this" },
      { targetId: "alignment", label: "Check alignment for this" },
      { targetId: "airesistant", label: "Make this AI-resistant" },
    ],
  },
  {
    id: "module",
    name: "Module Design",
    icon: "Layout",
    description: "Design complete course modules with learning activities and assessments",
    color: "primary",
  },
  {
    id: "rubric",
    name: "Rubric Builder",
    icon: "CheckCircle",
    description: "Build detailed, criteria-based rubrics with clear performance levels",
    color: "primary",
    chains: [
      { targetId: "alignment", label: "Check alignment for this rubric" },
    ],
  },
  {
    id: "grading",
    name: "Grading Policy Designer",
    icon: "Scale",
    description: "Design equitable grading policies that measure content knowledge, not compliance",
    color: "primary",
  },
  {
    id: "aipolicy",
    name: "AI Policy Generator",
    icon: "Sparkles",
    description: "Create clear, nuanced AI use policies tailored to your course and assignments",
    color: "primary",
  },
  {
    id: "alignment",
    name: "Alignment Checker",
    icon: "Target",
    description: "Verify how your assignments and assessments connect to learning outcomes",
    color: "primary",
  },
  {
    id: "airesistant",
    name: "AI-Resistant Assignment Designer",
    icon: "ShieldCheck",
    description: "Analyze assignments for AI vulnerability and get strategies to make them more authentic",
    color: "primary",
    chains: [
      { targetId: "aistudent", label: "Design an AI-powered activity for this" },
    ],
  },
  {
    id: "accessibility",
    name: "Accessibility Checker",
    icon: "Eye",
    description: "Analyze assignments for accessibility barriers and get research-based improvement ideas",
    color: "primary",
  },
  {
    id: "aistudent",
    name: "AI-Powered Activity Designer",
    icon: "Bot",
    description: "Design student activities that intentionally use AI as a learning tool",
    color: "primary",
  },
];

export function getChainPrefillFields(
  sourceToolId: string,
  targetToolId: string,
  formData: Record<string, any>,
  generatedContent: string,
): Record<string, any> {
  const truncated = (s: string, limit: number) => s.slice(0, limit);

  const map: Record<string, Record<string, () => Record<string, any>>> = {
    assignment: {
      rubric: () => ({
        assessmentType: formData.assignmentType || "",
        criteria: formData.learningObjectives || "",
      }),
      alignment: () => ({
        learningOutcomes: formData.learningObjectives || "",
        assignments: truncated(generatedContent, 1500),
      }),
      airesistant: () => ({
        existingAssignment: truncated(generatedContent, 2000),
        assignmentType: formData.assignmentType || "",
      }),
    },
    rubric: {
      alignment: () => ({
        assignments: truncated(generatedContent, 1500),
      }),
    },
    airesistant: {
      aistudent: () => ({
        learningObjectives: formData.additionalContext || "",
      }),
    },
  };

  return map[sourceToolId]?.[targetToolId]?.() ?? {};
}

// Maps each target tool to the source tool types whose generated content can
// be used to pre-populate the target tool's form fields.
// Mirrors the source→target chains in getChainedPrefillValues above.
export const CONTENT_PREFILL_MAP: Record<string, string[]> = {
  rubric: ["assignment"],
  alignment: ["assignment", "rubric", "syllabus"],
  airesistant: ["assignment"],
  accessibility: ["assignment"],
  module: ["assignment", "syllabus"],
  aistudent: ["airesistant", "assignment"],
};

export const LOADING_MESSAGES = [
  "Analyzing your course requirements...",
  "Incorporating UDL principles...",
  "Building comprehensive content structure...",
  "Adding accessibility features...",
  "Tailoring for Blackboard Ultra...",
  "Aligning with learning outcomes...",
  "Applying best practices in pedagogy...",
  "Finalizing your materials...",
  "Designing AI-powered student activities...",
];

export interface GenerationStep {
  label: string;
  ariaLabel: string;
  durationMs: number;
  minDurationMs?: number;
  maxDurationMs?: number;
}

export const AI_STEP_DURATION_MS = {
  single: { min: 5000, max: 18000 },
  batch: { min: 7000, max: 14000 },
} as const;

export function computeAiStepDuration(
  step: GenerationStep,
  outputDetail: string,
  isBatch: boolean,
  complexityScore?: number,
): number {
  const { minDurationMs, maxDurationMs, durationMs } = step;
  if (minDurationMs === undefined || maxDurationMs === undefined) return durationMs;
  if (isBatch) return maxDurationMs;
  const score =
    complexityScore !== undefined
      ? Math.max(0, Math.min(1, complexityScore))
      : outputDetail === "concise"
        ? 0
        : 1;
  return Math.round(minDurationMs + score * (maxDurationMs - minDurationMs));
}

export const GENERATION_STEPS: GenerationStep[] = [
  { label: "Assembling course context", ariaLabel: "Step 1: Assembling course context", durationMs: 1200 },
  { label: "Applying pedagogical frameworks", ariaLabel: "Step 2: Applying pedagogical frameworks", durationMs: 2000 },
  {
    label: "Generating content with AI",
    ariaLabel: "Step 3: Generating content with AI",
    durationMs: 12000,
    minDurationMs: AI_STEP_DURATION_MS.single.min,
    maxDurationMs: AI_STEP_DURATION_MS.single.max,
  },
  { label: "Formatting and post-processing", ariaLabel: "Step 4: Formatting and post-processing", durationMs: 1800 },
  { label: "Saving your materials", ariaLabel: "Step 5: Saving your materials", durationMs: 1000 },
];

export const BATCH_GENERATION_STEPS: GenerationStep[] = [
  { label: "Assembling course context", ariaLabel: "Step 1: Assembling course context", durationMs: 1200 },
  { label: "Applying pedagogical frameworks", ariaLabel: "Step 2: Applying pedagogical frameworks", durationMs: 2000 },
  {
    label: "Generating assignment with AI",
    ariaLabel: "Step 3: Generating assignment with AI",
    durationMs: 10000,
    minDurationMs: AI_STEP_DURATION_MS.batch.min,
    maxDurationMs: AI_STEP_DURATION_MS.batch.max,
  },
  {
    label: "Generating matching rubric with AI",
    ariaLabel: "Step 4: Generating matching rubric with AI",
    durationMs: 8000,
    minDurationMs: AI_STEP_DURATION_MS.batch.min,
    maxDurationMs: AI_STEP_DURATION_MS.batch.max,
  },
  { label: "Saving your materials", ariaLabel: "Step 5: Saving your materials", durationMs: 1000 },
];

export const FIX_TYPE_DESCRIPTIONS: Record<string, string> = {
  "fix-aria-combobox":
    'Swaps each element using role="combobox" for a native <select> element, keeping all existing attributes. A native <select> provides the built-in keyboard and screen-reader support that assistive technology expects.',
  "fix-aria-grid":
    'Swaps each element using role="grid" for a native <table> element, keeping all existing attributes. A native <table> lets screen readers announce rows and columns without relying on ARIA.',
  "fix-aria-tab":
    'Swaps each element using role="tab" for a native <button> element, keeping all existing attributes. A native <button> is keyboard-focusable and announced correctly by screen readers without extra ARIA.',
};

const FIX_TYPE_ALIASES: Record<string, string> = {
  "1.3.1::ARIA Combobox Role on Non-Combobox Element": "fix-aria-combobox",
  "1.3.1::ARIA Grid Role on Non-Table Element": "fix-aria-grid",
  "1.3.1::ARIA Tab Role on Non-Interactive Element": "fix-aria-tab",
};

export function getFixTypeDescription(fixType: string): string | undefined {
  return FIX_TYPE_DESCRIPTIONS[fixType] ?? FIX_TYPE_DESCRIPTIONS[FIX_TYPE_ALIASES[fixType]];
}
