export type BloomsLevel =
  | "Remember"
  | "Understand"
  | "Apply"
  | "Analyze"
  | "Evaluate"
  | "Create";

export type Discipline =
  | "Humanities"
  | "STEM"
  | "Social Sciences"
  | "Business"
  | "Education"
  | "Health Sciences"
  | "Arts";

export interface LearningOutcome {
  id: string;
  text: string;
  discipline: Discipline;
  bloomsLevel: BloomsLevel;
}

export const BLOOMS_LEVELS: BloomsLevel[] = [
  "Remember",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
];

export const DISCIPLINES: Discipline[] = [
  "Humanities",
  "STEM",
  "Social Sciences",
  "Business",
  "Education",
  "Health Sciences",
  "Arts",
];

export const OUTCOME_LIBRARY: LearningOutcome[] = [
  // Humanities — Remember
  {
    id: "hum-rem-1",
    text: "Identify key literary movements and their defining characteristics across historical periods.",
    discipline: "Humanities",
    bloomsLevel: "Remember",
  },
  {
    id: "hum-rem-2",
    text: "Recall major philosophical traditions and the thinkers associated with each.",
    discipline: "Humanities",
    bloomsLevel: "Remember",
  },
  // Humanities — Understand
  {
    id: "hum-und-1",
    text: "Explain how historical context shapes the meaning of literary and cultural texts.",
    discipline: "Humanities",
    bloomsLevel: "Understand",
  },
  {
    id: "hum-und-2",
    text: "Summarize the central arguments of canonical philosophical works in accessible language.",
    discipline: "Humanities",
    bloomsLevel: "Understand",
  },
  // Humanities — Apply
  {
    id: "hum-app-1",
    text: "Apply close-reading techniques to interpret primary texts from multiple cultural traditions.",
    discipline: "Humanities",
    bloomsLevel: "Apply",
  },
  {
    id: "hum-app-2",
    text: "Use a chosen theoretical framework (e.g., feminist, postcolonial) to read an assigned literary work.",
    discipline: "Humanities",
    bloomsLevel: "Apply",
  },
  // Humanities — Analyze
  {
    id: "hum-ana-1",
    text: "Analyze the rhetorical strategies an author uses to persuade or influence an audience.",
    discipline: "Humanities",
    bloomsLevel: "Analyze",
  },
  {
    id: "hum-ana-2",
    text: "Examine how power, identity, and representation are constructed in literary and cultural texts.",
    discipline: "Humanities",
    bloomsLevel: "Analyze",
  },
  // Humanities — Evaluate
  {
    id: "hum-eva-1",
    text: "Evaluate competing interpretations of a text, supporting a position with textual evidence.",
    discipline: "Humanities",
    bloomsLevel: "Evaluate",
  },
  {
    id: "hum-eva-2",
    text: "Critique the ethical assumptions embedded in a philosophical argument.",
    discipline: "Humanities",
    bloomsLevel: "Evaluate",
  },
  // Humanities — Create
  {
    id: "hum-cre-1",
    text: "Compose an original argumentative essay that advances a clear, evidence-based thesis.",
    discipline: "Humanities",
    bloomsLevel: "Create",
  },
  {
    id: "hum-cre-2",
    text: "Produce a creative work that engages with a cultural or historical theme studied in the course.",
    discipline: "Humanities",
    bloomsLevel: "Create",
  },

  // STEM — Remember
  {
    id: "stem-rem-1",
    text: "Define fundamental terms, concepts, and units used within the discipline.",
    discipline: "STEM",
    bloomsLevel: "Remember",
  },
  {
    id: "stem-rem-2",
    text: "Recall standard formulas, laws, and theorems relevant to the course content.",
    discipline: "STEM",
    bloomsLevel: "Remember",
  },
  // STEM — Understand
  {
    id: "stem-und-1",
    text: "Explain the underlying principles that govern the phenomena studied in this course.",
    discipline: "STEM",
    bloomsLevel: "Understand",
  },
  {
    id: "stem-und-2",
    text: "Describe the relationship between variables in key equations and models used in the field.",
    discipline: "STEM",
    bloomsLevel: "Understand",
  },
  // STEM — Apply
  {
    id: "stem-app-1",
    text: "Apply mathematical or computational methods to solve problems representative of the discipline.",
    discipline: "STEM",
    bloomsLevel: "Apply",
  },
  {
    id: "stem-app-2",
    text: "Conduct laboratory procedures safely and accurately, following established protocols.",
    discipline: "STEM",
    bloomsLevel: "Apply",
  },
  // STEM — Analyze
  {
    id: "stem-ana-1",
    text: "Analyze experimental data to identify patterns, anomalies, and potential sources of error.",
    discipline: "STEM",
    bloomsLevel: "Analyze",
  },
  {
    id: "stem-ana-2",
    text: "Differentiate between correlation and causation in quantitative studies within the field.",
    discipline: "STEM",
    bloomsLevel: "Analyze",
  },
  // STEM — Evaluate
  {
    id: "stem-eva-1",
    text: "Evaluate the validity and reliability of scientific studies using established methodological criteria.",
    discipline: "STEM",
    bloomsLevel: "Evaluate",
  },
  {
    id: "stem-eva-2",
    text: "Assess the ethical implications of emerging technologies or scientific discoveries.",
    discipline: "STEM",
    bloomsLevel: "Evaluate",
  },
  // STEM — Create
  {
    id: "stem-cre-1",
    text: "Design an original experiment or research study to test a hypothesis, including controls and methods.",
    discipline: "STEM",
    bloomsLevel: "Create",
  },
  {
    id: "stem-cre-2",
    text: "Develop a technical report or scientific poster that communicates research findings to a professional audience.",
    discipline: "STEM",
    bloomsLevel: "Create",
  },

  // Social Sciences — Remember
  {
    id: "ss-rem-1",
    text: "Identify major theoretical frameworks (e.g., functionalism, conflict theory) used in the social sciences.",
    discipline: "Social Sciences",
    bloomsLevel: "Remember",
  },
  {
    id: "ss-rem-2",
    text: "List key research methods used in qualitative and quantitative social science research.",
    discipline: "Social Sciences",
    bloomsLevel: "Remember",
  },
  // Social Sciences — Understand
  {
    id: "ss-und-1",
    text: "Explain how social structures, institutions, and cultural norms shape individual behavior.",
    discipline: "Social Sciences",
    bloomsLevel: "Understand",
  },
  {
    id: "ss-und-2",
    text: "Summarize the historical development of a major social theory and its key proponents.",
    discipline: "Social Sciences",
    bloomsLevel: "Understand",
  },
  // Social Sciences — Apply
  {
    id: "ss-app-1",
    text: "Apply a social science theory to interpret a current event or contemporary social issue.",
    discipline: "Social Sciences",
    bloomsLevel: "Apply",
  },
  {
    id: "ss-app-2",
    text: "Use basic statistical methods to analyze survey or observational data.",
    discipline: "Social Sciences",
    bloomsLevel: "Apply",
  },
  // Social Sciences — Analyze
  {
    id: "ss-ana-1",
    text: "Analyze how race, class, gender, and other identity categories intersect to produce social inequality.",
    discipline: "Social Sciences",
    bloomsLevel: "Analyze",
  },
  {
    id: "ss-ana-2",
    text: "Examine the strengths and limitations of a research design used in a peer-reviewed social science study.",
    discipline: "Social Sciences",
    bloomsLevel: "Analyze",
  },
  // Social Sciences — Evaluate
  {
    id: "ss-eva-1",
    text: "Evaluate policy proposals using evidence-based reasoning and ethical analysis.",
    discipline: "Social Sciences",
    bloomsLevel: "Evaluate",
  },
  {
    id: "ss-eva-2",
    text: "Judge the credibility and relevance of sources when constructing a social science argument.",
    discipline: "Social Sciences",
    bloomsLevel: "Evaluate",
  },
  // Social Sciences — Create
  {
    id: "ss-cre-1",
    text: "Design a community-based research project addressing a local social problem.",
    discipline: "Social Sciences",
    bloomsLevel: "Create",
  },
  {
    id: "ss-cre-2",
    text: "Construct an evidence-based policy brief that presents findings and actionable recommendations.",
    discipline: "Social Sciences",
    bloomsLevel: "Create",
  },

  // Business — Remember
  {
    id: "bus-rem-1",
    text: "Define core business concepts including supply and demand, market structures, and financial statements.",
    discipline: "Business",
    bloomsLevel: "Remember",
  },
  {
    id: "bus-rem-2",
    text: "Identify the stages of the strategic planning process and key frameworks (e.g., SWOT, PESTLE).",
    discipline: "Business",
    bloomsLevel: "Remember",
  },
  // Business — Understand
  {
    id: "bus-und-1",
    text: "Explain how organizational culture and leadership style influence employee performance.",
    discipline: "Business",
    bloomsLevel: "Understand",
  },
  {
    id: "bus-und-2",
    text: "Describe the ethical responsibilities of businesses toward stakeholders and the broader community.",
    discipline: "Business",
    bloomsLevel: "Understand",
  },
  // Business — Apply
  {
    id: "bus-app-1",
    text: "Apply financial analysis techniques to interpret balance sheets, income statements, and cash-flow reports.",
    discipline: "Business",
    bloomsLevel: "Apply",
  },
  {
    id: "bus-app-2",
    text: "Use a marketing framework to develop a campaign strategy for a product or service.",
    discipline: "Business",
    bloomsLevel: "Apply",
  },
  // Business — Analyze
  {
    id: "bus-ana-1",
    text: "Analyze a business case study to identify the root causes of organizational success or failure.",
    discipline: "Business",
    bloomsLevel: "Analyze",
  },
  {
    id: "bus-ana-2",
    text: "Examine the competitive landscape of an industry using Porter's Five Forces or comparable models.",
    discipline: "Business",
    bloomsLevel: "Analyze",
  },
  // Business — Evaluate
  {
    id: "bus-eva-1",
    text: "Evaluate the risks and benefits of a proposed business strategy from multiple stakeholder perspectives.",
    discipline: "Business",
    bloomsLevel: "Evaluate",
  },
  // Business — Create
  {
    id: "bus-cre-1",
    text: "Develop a comprehensive business plan including financial projections, market analysis, and operational strategy.",
    discipline: "Business",
    bloomsLevel: "Create",
  },

  // Education — Remember
  {
    id: "edu-rem-1",
    text: "Identify major learning theories (e.g., behaviorism, constructivism, social learning) and their key concepts.",
    discipline: "Education",
    bloomsLevel: "Remember",
  },
  // Education — Understand
  {
    id: "edu-und-1",
    text: "Explain how Universal Design for Learning (UDL) principles support diverse learners in inclusive classrooms.",
    discipline: "Education",
    bloomsLevel: "Understand",
  },
  {
    id: "edu-und-2",
    text: "Describe developmentally appropriate practices for learners at different stages of cognitive and social development.",
    discipline: "Education",
    bloomsLevel: "Understand",
  },
  // Education — Apply
  {
    id: "edu-app-1",
    text: "Design lesson plans that incorporate differentiated instruction strategies for diverse learning needs.",
    discipline: "Education",
    bloomsLevel: "Apply",
  },
  {
    id: "edu-app-2",
    text: "Apply formative and summative assessment strategies to measure student learning outcomes.",
    discipline: "Education",
    bloomsLevel: "Apply",
  },
  // Education — Analyze
  {
    id: "edu-ana-1",
    text: "Analyze how systemic factors (e.g., poverty, race, language) affect educational equity and student achievement.",
    discipline: "Education",
    bloomsLevel: "Analyze",
  },
  // Education — Evaluate
  {
    id: "edu-eva-1",
    text: "Evaluate curriculum materials for alignment with learning standards, cultural responsiveness, and accessibility.",
    discipline: "Education",
    bloomsLevel: "Evaluate",
  },
  // Education — Create
  {
    id: "edu-cre-1",
    text: "Develop a unit plan that integrates multiple content areas, assessment strategies, and UDL-aligned materials.",
    discipline: "Education",
    bloomsLevel: "Create",
  },

  // Health Sciences — Remember
  {
    id: "hs-rem-1",
    text: "Identify anatomical structures and physiological processes relevant to the systems studied in the course.",
    discipline: "Health Sciences",
    bloomsLevel: "Remember",
  },
  // Health Sciences — Understand
  {
    id: "hs-und-1",
    text: "Explain the pathophysiology of common conditions studied in the course and their clinical presentations.",
    discipline: "Health Sciences",
    bloomsLevel: "Understand",
  },
  {
    id: "hs-und-2",
    text: "Describe evidence-based practices and clinical guidelines relevant to the course topic area.",
    discipline: "Health Sciences",
    bloomsLevel: "Understand",
  },
  // Health Sciences — Apply
  {
    id: "hs-app-1",
    text: "Apply clinical reasoning skills to interpret patient data and develop appropriate care plans.",
    discipline: "Health Sciences",
    bloomsLevel: "Apply",
  },
  // Health Sciences — Analyze
  {
    id: "hs-ana-1",
    text: "Analyze health disparities among populations using epidemiological data and social determinants of health.",
    discipline: "Health Sciences",
    bloomsLevel: "Analyze",
  },
  // Health Sciences — Evaluate
  {
    id: "hs-eva-1",
    text: "Evaluate the effectiveness of health interventions using outcome data and patient-centered measures.",
    discipline: "Health Sciences",
    bloomsLevel: "Evaluate",
  },
  // Health Sciences — Create
  {
    id: "hs-cre-1",
    text: "Design a culturally responsive health education program that addresses a specific community health need.",
    discipline: "Health Sciences",
    bloomsLevel: "Create",
  },

  // Arts — Remember
  {
    id: "art-rem-1",
    text: "Identify the formal elements and principles of design (line, shape, color, texture, balance, rhythm) in visual works.",
    discipline: "Arts",
    bloomsLevel: "Remember",
  },
  // Arts — Understand
  {
    id: "art-und-1",
    text: "Explain how historical, cultural, and social contexts shape the production and reception of artworks.",
    discipline: "Arts",
    bloomsLevel: "Understand",
  },
  // Arts — Apply
  {
    id: "art-app-1",
    text: "Demonstrate proficiency with discipline-specific tools, materials, and techniques through studio practice.",
    discipline: "Arts",
    bloomsLevel: "Apply",
  },
  {
    id: "art-app-2",
    text: "Apply an established artistic style or tradition in the creation of original studio work.",
    discipline: "Arts",
    bloomsLevel: "Apply",
  },
  // Arts — Analyze
  {
    id: "art-ana-1",
    text: "Analyze works of art using formal analysis, iconographic interpretation, and contextual critique.",
    discipline: "Arts",
    bloomsLevel: "Analyze",
  },
  // Arts — Evaluate
  {
    id: "art-eva-1",
    text: "Evaluate peer artwork through structured critique, applying discipline-specific criteria constructively.",
    discipline: "Arts",
    bloomsLevel: "Evaluate",
  },
  // Arts — Create
  {
    id: "art-cre-1",
    text: "Produce a cohesive body of original work demonstrating conceptual intentionality and technical skill.",
    discipline: "Arts",
    bloomsLevel: "Create",
  },
  {
    id: "art-cre-2",
    text: "Develop an artist statement that articulates the conceptual and aesthetic goals of a completed project.",
    discipline: "Arts",
    bloomsLevel: "Create",
  },
];
