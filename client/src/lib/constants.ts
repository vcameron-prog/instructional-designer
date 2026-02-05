export const COURSE_LEVELS = [
  "Undergraduate - 100 level",
  "Undergraduate - 200 level",
  "Undergraduate - 300 level",
  "Undergraduate - 400 level",
  "Graduate",
  "Continuing Education",
];

export const CREDIT_OPTIONS = ["0", "1", "2", "3", "4"];

export const SEMESTERS = [
  "Fall 2025",
  "Spring 2026",
  "Summer 2026 Session I",
  "Summer 2026 Session II",
  "Fall 2026",
  "Spring 2027",
  "Summer 2027 Session I",
  "Summer 2027 Session II",
];

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

export const TOOLS = [
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
  },
];

export const LOADING_MESSAGES = [
  "Analyzing your course requirements...",
  "Incorporating UDL principles...",
  "Building comprehensive content structure...",
  "Adding accessibility features...",
  "Tailoring for Blackboard Ultra...",
  "Aligning with learning outcomes...",
  "Applying best practices in pedagogy...",
  "Finalizing your materials...",
];
