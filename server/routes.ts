import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { insertCourseSchema, type Course, courses, conversions, generatedContent, contentVersions } from "@shared/schema";
import { users } from "@shared/models/auth";
import {
  setupAuth,
  registerAuthRoutes,
  isAuthenticated,
  optionalAuth,
} from "./replit_integrations/auth";
import Anthropic from "@anthropic-ai/sdk";
import multer from "multer";
import { z } from "zod";
import { db } from "./db";
import { eq, and, desc, isNull, sql, inArray } from "drizzle-orm";
import { convertMarkdownTablesToHtml } from "./markdownTableConverter.js";
import { fixHtmlTableCaption, fixHtmlTableThead, editHtmlTableCaption } from "./lib/table-fixers.js";
import { getDeterministicFixerKeys } from "./lib/accessibility-engine";

function getUserId(req: Request): string | null {
  return (req.user as any)?.claims?.sub ?? null;
}
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
} from "docx";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  timeout: 5 * 60 * 1000,
  maxRetries: 2,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const anonRateLimits = new Map<string, { count: number; resetAt: number }>();
const ANON_RATE_LIMIT = 10;
const ANON_RATE_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_VERSION_HISTORY_LIMIT = 10;
const _parsedVersionHistoryLimit = parseInt(process.env.VERSION_HISTORY_LIMIT ?? "", 10);
const VERSION_HISTORY_LIMIT: number = (() => {
  if (isNaN(_parsedVersionHistoryLimit) || _parsedVersionHistoryLimit <= 0) {
    if (process.env.VERSION_HISTORY_LIMIT !== undefined) {
      console.warn(
        `[config] VERSION_HISTORY_LIMIT="${process.env.VERSION_HISTORY_LIMIT}" is invalid (must be a positive integer). Falling back to default of ${DEFAULT_VERSION_HISTORY_LIMIT}.`
      );
    }
    return DEFAULT_VERSION_HISTORY_LIMIT;
  }
  return _parsedVersionHistoryLimit;
})();

/**
 * Strip characters that would break a Content-Disposition filename="..." header:
 * null bytes, newlines (header-injection), double quotes (value terminator).
 * Truncates to 200 chars to prevent excessively long headers.
 */
function sanitizeHeaderFilename(filename: string): string {
  return filename
    .replace(/[\x00\r\n"]/g, "_")
    .slice(0, 200);
}

function checkAnonRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = anonRateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    anonRateLimits.set(ip, { count: 1, resetAt: now + ANON_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= ANON_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

setInterval(
  () => {
    const now = Date.now();
    for (const [ip, entry] of anonRateLimits) {
      if (now > entry.resetAt) anonRateLimits.delete(ip);
    }
  },
  10 * 60 * 1000,
);

// Heavy-operation rate limiting (applies to both anonymous and authenticated users)
const heavyOpRateLimits = new Map<string, { count: number; resetAt: number }>();
const HEAVY_OP_RATE_LIMIT = parseInt(process.env.HEAVY_OP_RATE_LIMIT ?? "5", 10) || 5;
const HEAVY_OP_RATE_WINDOW_MS = 60 * 60 * 1000;

function checkHeavyOpRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = heavyOpRateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    heavyOpRateLimits.set(key, { count: 1, resetAt: now + HEAVY_OP_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= HEAVY_OP_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of heavyOpRateLimits) {
      if (now > entry.resetAt) heavyOpRateLimits.delete(key);
    }
  },
  10 * 60 * 1000,
);

// Per-user AI generation rate limiting
const aiGenRateLimits = new Map<string, { count: number; resetAt: number }>();
const AI_GEN_RATE_LIMIT = parseInt(process.env.AI_GEN_RATE_LIMIT ?? "20", 10) || 20;
const AI_GEN_RATE_WINDOW_MS = 60 * 60 * 1000;

function checkAiGenRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = aiGenRateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    aiGenRateLimits.set(key, { count: 1, resetAt: now + AI_GEN_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= AI_GEN_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of aiGenRateLimits) {
      if (now > entry.resetAt) aiGenRateLimits.delete(key);
    }
  },
  10 * 60 * 1000,
);

// Per-user conversion upload rate limiting
const uploadRateLimits = new Map<string, { count: number; resetAt: number }>();
const UPLOAD_RATE_LIMIT = parseInt(process.env.UPLOAD_RATE_LIMIT ?? "30", 10) || 30;
const UPLOAD_RATE_WINDOW_MS = 60 * 60 * 1000;

function checkUploadRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = uploadRateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    uploadRateLimits.set(key, { count: 1, resetAt: now + UPLOAD_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= UPLOAD_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of uploadRateLimits) {
      if (now > entry.resetAt) uploadRateLimits.delete(key);
    }
  },
  10 * 60 * 1000,
);

// Concurrency guards for expensive background operations
let activeProcessingJobs = 0;
const MAX_CONCURRENT_PROCESSING = parseInt(process.env.MAX_CONCURRENT_PROCESSING ?? "3", 10) || 3;

let activePdfExports = 0;
const MAX_CONCURRENT_PDF_EXPORTS = parseInt(process.env.MAX_CONCURRENT_PDF_EXPORTS ?? "2", 10) || 2;

let activeFixJobs = 0;
const MAX_CONCURRENT_FIXES = parseInt(process.env.MAX_CONCURRENT_FIXES ?? "3", 10) || 3;
const activeFixKeys = new Set<string>();

let activeDocxExports = 0;
const MAX_CONCURRENT_DOCX_EXPORTS = parseInt(process.env.MAX_CONCURRENT_DOCX_EXPORTS ?? "3", 10) || 3;

// Generate prompt based on tool and course info
function generatePrompt(
  toolId: string,
  toolData: Record<string, any>,
  course: Course | null,
): string {
  const syllabusContext = course?.existingSyllabus
    ? `\n\nEXISTING SYLLABUS CONTENT (use this to maintain consistency with the course's established structure, topics, assessments, and terminology):\n${course.existingSyllabus}`
    : "";

  // Build inclusive design sections based on user selections (for assignment tool)
  const inclusiveOptions = toolData.inclusiveDesignOptions || [];
  const hasUDL = inclusiveOptions.includes(
    "UDL (Universal Design for Learning)",
  );
  const hasCultural = inclusiveOptions.includes(
    "Cultural Relevance & Inclusivity",
  );
  const hasSEL = inclusiveOptions.includes("SEL (Social-Emotional Learning)");
  const hasAccessibility = inclusiveOptions.includes("Accessibility Features");
  const hasAIPowered = inclusiveOptions.includes(
    "AI-Powered Student Activities",
  );
  const hasAnyInclusive = inclusiveOptions.length > 0;

  const wcagRequirements = `
**ADA TITLE II / WCAG 2.1 AA COMPLIANCE — MANDATORY FOR ALL OUTPUT:**
All generated content MUST meet WCAG 2.1 Level AA accessibility standards:
- HEADINGS: Use a logical heading hierarchy (h1 → h2 → h3). Never skip heading levels (e.g., h1 directly to h3).
- SEMANTIC HTML: Use proper semantic elements — <ul>/<ol> for lists, <strong> for emphasis, <em> for italic meaning, <blockquote> for quotations.
- TABLES: Every table MUST include <caption>, <thead> with <th scope="col">, and use <th scope="row"> for row headers. Never use tables for layout.
- LINKS: All links must have descriptive text. Never use "click here" or "read more" as link text.
- CONTRAST: When specifying colors in inline styles, ensure at least 4.5:1 contrast ratio for normal text and 3:1 for large text.
- READING ORDER: Content must follow a logical linear reading order in the DOM. Do not use absolute positioning or visual-only ordering.
- LANGUAGE: If outputting a full HTML document, include lang="en" on the <html> element.
- IMAGES: Every <img> must have a meaningful, descriptive alt attribute. Use alt="" only for purely decorative images.
- LANDMARKS: Use ARIA landmarks or HTML5 semantic containers (<main>, <nav>, <header>, <footer>, <section>, <article>) for document structure.
- CLEAR LANGUAGE: Use plain, direct language. Define jargon and acronyms on first use.
`;

  // Standard base context with all frameworks (for most tools)
  const baseContext = `You are an expert instructional designer creating materials for Bridgewater State University faculty. Create comprehensive, ready-to-implement content that incorporates THREE KEY PEDAGOGICAL FRAMEWORKS:

1. **UNIVERSAL DESIGN FOR LEARNING (UDL)**
   - Engagement: Multiple ways to motivate and engage learners
   - Representation: Multiple ways to present information
   - Action & Expression: Multiple ways for students to demonstrate learning

2. **CULTURAL RELEVANCE & INCLUSIVITY**
   - Include diverse perspectives, authors, and examples
   - Honor student identities and backgrounds
   - Use inclusive language and avoid assumptions
   - Consider diverse ways of knowing and demonstrating competence

3. **SOCIAL-EMOTIONAL LEARNING (SEL)**
   - Self-awareness and reflection opportunities
   - Relationship and collaboration skills
   - Responsible decision-making
   - Supportive, growth-oriented framing
   - Attention to student wellbeing

COURSE INFORMATION:
${
  course
    ? `Course: ${course.courseName} (${course.courseNumber}${course.sectionNumber ? `, Section ${course.sectionNumber}` : ""})
Level: ${course.courseLevel}
Credits: ${course.credits}
Semester: ${course.semester}
Instructor: ${course.instructor}
Department: ${course.department}
Prerequisites: ${course.prerequisites || "None"}

Course Description: ${course.courseDescription}

Primary Learning Outcomes: ${course.learningOutcomes}

Additional Context: ${course.additionalContext || "None provided"}${syllabusContext}`
    : `${toolData.subject ? `Subject/Department: ${toolData.subject}` : ""}
${toolData.courseLevel ? `Level: ${toolData.courseLevel}` : ""}
Note: This is a standalone quick tool usage without full course context. Generate high-quality, broadly applicable content based on the provided information.`
}

${wcagRequirements}
**CRITICAL FORMATTING RULES - FOLLOW EXACTLY:**
- DO NOT use markdown table syntax (no |---|---| or | column | column | formats)
- For non-tabular data, use clear formatted lists with bold labels
- If data is truly tabular, use accessible HTML tables (with caption, thead, th scope) per the WCAG rules above
- Use **bold labels** followed by content on the same line or as sub-bullets
- For schedules and matrices, use numbered sections with clear headings
- Keep output clean and readable without complex formatting symbols`;

  // Conditional base context for assignment tool (only include selected frameworks)
  const assignmentBaseContext = `You are an expert instructional designer creating materials for Bridgewater State University faculty. Create comprehensive, ready-to-implement content.
${hasAnyInclusive ? "\nIncorporate the following pedagogical framework(s) selected by the instructor:" : ""}
${
  hasUDL
    ? `
**UNIVERSAL DESIGN FOR LEARNING (UDL)** - Based on CAST's UDL Guidelines (cast.org):
- Engagement: Multiple ways to motivate and engage learners (Guidelines 7-9)
- Representation: Multiple ways to present information (Guidelines 1-3)
- Action & Expression: Multiple ways for students to demonstrate learning (Guidelines 4-6)
`
    : ""
}${
    hasCultural
      ? `
**CULTURAL RELEVANCE & INCLUSIVITY** - Based on Geneva Gay's Culturally Responsive Teaching:
- Include diverse perspectives, authors, and examples
- Honor student identities and backgrounds
- Use inclusive language and avoid assumptions
- Consider diverse ways of knowing and demonstrating competence
`
      : ""
  }${
    hasSEL
      ? `
**SOCIAL-EMOTIONAL LEARNING (SEL)** - Based on CASEL's SEL Framework (casel.org):
- Self-awareness and reflection opportunities
- Relationship and collaboration skills
- Responsible decision-making
- Supportive, growth-oriented framing
- Attention to student wellbeing
`
      : ""
  }${
    hasAccessibility
      ? `
**ACCESSIBILITY** - Based on WCAG 2.1 and Section 508 Standards:
- Document structure and readability
- Multiple format options
- Assistive technology compatibility
- Cognitive accessibility considerations
`
      : ""
  }${
    hasAIPowered
      ? `
**AI-POWERED STUDENT ACTIVITIES** - Based on evidence-based AI pedagogy (EDUCAUSE, Mollick & Mollick 2023):
- Design intentional AI interaction points where students use AI as a learning tool
- Include critical evaluation requirements for AI-generated content
- Require documentation of AI use and metacognitive reflection
- Apply Bloom's taxonomy to AI interactions (moving beyond "generate" to "evaluate" and "create")
- Build AI literacy skills alongside content knowledge
`
      : ""
  }
COURSE INFORMATION:
${
  course
    ? `Course: ${course.courseName} (${course.courseNumber}${course.sectionNumber ? `, Section ${course.sectionNumber}` : ""})
Level: ${course.courseLevel}
Credits: ${course.credits}
Semester: ${course.semester}
Instructor: ${course.instructor}
Department: ${course.department}
Prerequisites: ${course.prerequisites || "None"}

Course Description: ${course.courseDescription}

Primary Learning Outcomes: ${course.learningOutcomes}

Additional Context: ${course.additionalContext || "None provided"}${syllabusContext}`
    : `${toolData.subject ? `Subject/Department: ${toolData.subject}` : ""}
${toolData.courseLevel ? `Level: ${toolData.courseLevel}` : ""}
Note: This is a standalone quick tool usage without full course context. Generate high-quality, broadly applicable content based on the provided information.`
}

${wcagRequirements}
**CRITICAL FORMATTING RULES - FOLLOW EXACTLY:**
- DO NOT use markdown table syntax (no |---|---| or | column | column | formats)
- For non-tabular data, use clear formatted lists with bold labels
- If data is truly tabular, use accessible HTML tables (with caption, thead, th scope) per the WCAG rules above
- Use **bold labels** followed by content on the same line or as sub-bullets
- For schedules and matrices, use numbered sections with clear headings
- Keep output clean and readable without complex formatting symbols`;

  // Neutral base context for Accessibility Checker (no forced frameworks)
  const accessibilityBaseContext = `You are an expert in accessible design, Universal Design for Learning (UDL), and inclusive education. Analyze course content for accessibility barriers and provide research-based recommendations.

COURSE INFORMATION:
${
  course
    ? `Course: ${course.courseName} (${course.courseNumber}${course.sectionNumber ? `, Section ${course.sectionNumber}` : ""})
Level: ${course.courseLevel}
Department: ${course.department}`
    : `${toolData.subject ? `Subject/Department: ${toolData.subject}` : ""}
${toolData.courseLevel ? `Level: ${toolData.courseLevel}` : ""}`
}

${wcagRequirements}
**CRITICAL FORMATTING RULES - FOLLOW EXACTLY:**
- DO NOT use markdown table syntax (no |---|---| or | column | column | formats)
- For non-tabular data, use clear formatted lists with bold labels
- If data is truly tabular, use accessible HTML tables (with caption, thead, th scope) per the WCAG rules above
- Use **bold labels** followed by content on the same line or as sub-bullets
- Keep output clean and readable without complex formatting symbols
- Do NOT include sentences like "If you find you are spending significantly more time, please reach out for support." — avoid any meta-commentary about estimated completion time or encouragement to seek help if the task takes longer than expected`;

  let inclusiveDesignSection = "";
  if (hasAnyInclusive) {
    inclusiveDesignSection = `

**INCLUSIVE DESIGN SECTION** (include this as a dedicated section in the output with research citations):
`;
    if (hasUDL) {
      inclusiveDesignSection += `
**UDL (Universal Design for Learning)** - Based on CAST's UDL Guidelines (cast.org):
- **Multiple Means of Engagement**: Offer choices in how students approach the assignment, include self-regulation strategies, and connect to student interests (Guideline 7-9)
- **Multiple Means of Representation**: Present instructions in varied formats (text, visual, video options), clarify vocabulary, and highlight patterns (Guideline 1-3)
- **Multiple Means of Action & Expression**: Allow flexible submission formats (written, recorded, visual), provide scaffolding tools, and support executive function (Guideline 4-6)
- Cite specific UDL principles being applied
`;
    }
    if (hasCultural) {
      inclusiveDesignSection += `
**Cultural Relevance & Inclusivity** - Based on Geneva Gay's Culturally Responsive Teaching and Gloria Ladson-Billings' research:
- **Diverse Perspectives**: Include readings, examples, or case studies from diverse cultural backgrounds and global perspectives
- **Student Identity**: Provide options for students to connect content to their own cultural backgrounds, communities, or lived experiences
- **Inclusive Language**: Use non-exclusionary language and avoid cultural assumptions
- **Diverse Ways of Knowing**: Recognize and validate different approaches to demonstrating competence
- Reference culturally responsive pedagogy principles
`;
    }
    if (hasSEL) {
      inclusiveDesignSection += `
**Social-Emotional Learning (SEL)** - Based on CASEL's SEL Framework (casel.org):
- **Self-Awareness**: Include reflection prompts that help students recognize their strengths, growth areas, and emotions around the work
- **Self-Management**: Build in stress management strategies, time management supports, and growth mindset framing
- **Relationship Skills**: Include opportunities for peer collaboration, feedback, or community building
- **Responsible Decision-Making**: Encourage ethical considerations and thoughtful choices
- Use supportive, developmental language that emphasizes learning over judgment
- Reference CASEL competencies being addressed
`;
    }
    if (hasAccessibility) {
      inclusiveDesignSection += `
**Accessibility Features** - Based on WCAG Guidelines and Section 508 standards:
- **Document Accessibility**: Ensure instructions use proper heading structure, alt text descriptions for images, and readable fonts
- **Flexible Formats**: Offer content in multiple formats (PDF, HTML, audio) when possible
- **Time & Pacing**: Consider extended time options and chunked deadlines for students who need accommodations
- **Assistive Technology Compatibility**: Ensure materials work with screen readers and other assistive technologies
- **Cognitive Accessibility**: Use clear, simple language; break complex tasks into steps; provide examples
- Reference specific accessibility standards being met
`;
    }
    if (hasAIPowered) {
      inclusiveDesignSection += `
**AI-Powered Student Activities** - Based on evidence-based AI pedagogy (EDUCAUSE 2025, Mollick & Mollick 2023, Bowen & Watson 2024):
- **AI Interaction Points**: Identify 2-3 specific moments in the assignment where students should use AI as a learning tool (e.g., brainstorming, drafting, peer simulation, feedback)
- **Critical Evaluation**: Require students to evaluate, fact-check, or critique AI-generated output rather than accepting it uncritically
- **Documentation Requirements**: Students should document their AI interactions (prompts used, outputs received, revisions made)
- **Metacognitive Reflection**: Include reflection prompts about what students learned from the AI interaction, how it changed their thinking, and what the AI got wrong
- **Bloom's Taxonomy Integration**: Design AI tasks that move beyond lower-order skills (remember, understand) to higher-order skills (analyze, evaluate, create) — students should use AI as a starting point, then apply critical thinking
- **AI Literacy Development**: Help students understand AI capabilities, limitations, and appropriate use in academic and professional contexts
- Reference specific AI pedagogy research and best practices
`;
    }
  }

  const duration = toolData.duration || "Flexible";
  const durLower = duration.toLowerCase();
  const isShortDuration =
    /^[1-5]\s*hour/i.test(duration) ||
    /\b(1\s*(class|day|session|period|hour)|single\s*(class|session|period|day)|one\s*(class|session|period|day|hour))\b/.test(
      durLower,
    ) ||
    (() => {
      const minMatch = durLower.match(/(\d{1,3})\s*(min|mins|minutes|minute)/);
      return minMatch ? parseInt(minMatch[1]) <= 90 : false;
    })();

  const durationGuidance = isShortDuration
    ? `\n**DURATION-AWARE SCOPING — CRITICAL:**
The instructor specified a SHORT duration ("${duration}"). You MUST scope the assignment to fit this timeframe:
- Keep the assignment focused and concise — a single, well-defined task rather than a multi-part project (completable within ${duration})
- Limit to 2-3 clear learning objectives, not an exhaustive list
- Instructions should be brief and actionable — no multi-phase or multi-day workflows
- Limit instructions to what can realistically be completed in one class session (approximately 50-75 minutes)
- Do NOT generate multi-hour or multi-day content for a single-session assignment
- Reduce the number of steps, deliverables, and resources to match the short timeframe
- Focus on depth over breadth — one clear activity rather than many shallow ones
- Grading criteria should be simple and focused (3-5 criteria max)
- Do NOT include extensive timelines, milestones, or multi-session breakdowns
- Resources section should list only 2-3 essential items, not a comprehensive bibliography
- Keep supplementary sections (resources, grading criteria) brief and proportional
- Overall output should be SHORT and practical — a busy instructor should be able to read it in under 2 minutes
- Do NOT include sentences like "If you find you are spending significantly more time, please reach out for support." — avoid any meta-commentary about estimated completion time or encouragement to seek help if the task takes longer than expected\n`
    : "";

  const prompts: Record<string, string> = {
    assignment: `${assignmentBaseContext}
${durationGuidance}
Create a COMPLETE assignment that includes:
1. Clear title and overview
2. Detailed learning objectives
3. Comprehensive step-by-step instructions
4. Submission requirements for Blackboard Ultra
5. Grading criteria overview
6. Resources and support materials
${!isShortDuration ? "7. Timeline and milestones" : ""}
${inclusiveDesignSection}
Assignment Type: ${toolData.assignmentType}
Learning Objectives: ${toolData.learningObjectives}
Duration: ${duration}
${hasAnyInclusive ? `Selected Inclusive Design Frameworks: ${inclusiveOptions.join(", ")}` : ""}
Additional Context: ${toolData.additionalContext || "None"}`,

    rubric: `${baseContext}

Create a COMPLETE rubric with:
1. Clear title and purpose
2. Detailed criteria descriptions
3. Performance level descriptors (${toolData.levels})
4. Point values totaling ${toolData.totalPoints} points
5. Specific observable behaviors for each level
6. Ready for Blackboard Ultra

**INCLUSIVE DESIGN CONSIDERATIONS** (weave these into the rubric criteria):
7. **UDL-Aligned Criteria**: Criteria that allow diverse approaches to demonstrating mastery, not just one "right way"
8. **Culturally Responsive Assessment**: Criteria free from cultural bias, recognizing diverse communication styles and perspectives
9. **Growth-Oriented Language**: Use supportive, developmental framing that emphasizes learning over judgment

Assessment Type: ${toolData.assessmentType}
Total Points: ${toolData.totalPoints}
Criteria: ${toolData.criteria}
Additional Context: ${toolData.additionalContext || "None"}`,

    module: `${baseContext}

Create a COMPLETE module with:
1. Module title and overview
2. Detailed learning outcomes
3. Week-by-week content breakdown
4. Reading assignments with purpose
5. Learning activities with instructions
6. Assessment components
7. Blackboard organization structure

**INCLUSIVE DESIGN SECTION** (include as a dedicated section):
8. **UDL Implementation**: 
   - Multiple formats for content (text, video, audio options)
   - Flexible ways to demonstrate learning
   - Built-in supports and scaffolding
9. **Cultural Relevance**:
   - Diverse authors, examples, and case studies
   - Connections to students' lived experiences
   - Global perspectives on the topic
10. **SEL Integration**:
    - Community-building activities
    - Reflection and self-assessment opportunities
    - Stress management and pacing considerations

Module Title: ${toolData.moduleTitle}
Duration: ${toolData.moduleDuration}
Learning Outcomes: ${toolData.learningOutcomes}
Additional Context: ${toolData.additionalContext || "None"}`,

    syllabus: `${baseContext}

REVISION GOALS:
${toolData.revisionGoals?.map((goal: string) => `- ${goal}`).join("\n") || "General enhancement"}

CURRENT SYLLABUS CONTENT:
${course?.existingSyllabus || ""}
${toolData.currentSyllabusText || ""}
${!course?.existingSyllabus && !toolData.currentSyllabusText ? "No existing syllabus provided - create a new syllabus based on the course information above." : ""}

SPECIFIC CONCERNS:
${toolData.specificConcerns || "None specified"}

Create or revise the syllabus following BSU's OFFICIAL SYLLABUS TEMPLATE structure exactly:

1. **COURSE HEADER**
   - Course Number/Section Number
   - Course Title
   - "Bridgewater State University"

2. **COURSE WELCOME** (warm, encouraging, partnership tone)
   - Personal welcome from instructor with pronouns
   - Brief background and enthusiasm for teaching this course
   - Set collaborative, student-centered tone

3. **COURSE INFORMATION AT-A-GLANCE** (use formatted list with bold labels)
   - Instructor name
   - Office Hours
   - Office Location
   - Office Phone
   - E-Mail (with response time commitment)
   - Textbook(s) with title, author, edition, ISBN
   - Course Meeting Dates/Times
   - Classroom Location

4. **COURSE TECHNOLOGY AND STUDENT SUPPORT**
   - myBSU portal link
   - Blackboard Ultra information
   - Online Student Support & Success link

5. **LEARNING OUTCOMES SECTION**
   - Brief course description
   - Overarching learning goal (what students should retain a year later)
   - Course Learning Outcomes (numbered list)
   - Module Learning Outcomes (if applicable)

6. **ASSIGNMENTS & ACTIVITIES**
   For each major assignment include:
   - Assignment Title with percentage of grade
   - Assignment Description
   - Instructions
   - Connection to course/module learning outcomes
   - Note: Rubrics will be provided separately

7. **EXAMS, TESTS, & QUIZZES** (if applicable)
   - Description of each assessment
   - Instructions
   - Relevant learning outcomes being assessed

8. **GRADING POLICIES**
   - Late or missed work policy
   - Attendance policy (unexpected and anticipated absences)
   - Participation policies
   - Grade notification timeline
   - Final grading scale

9. **BSU POLICIES AND RESOURCES**
   - Online Student Support & Success
   - Academic Support Resources
   - Belongingness and Wellness Resources
   - Student Crisis Resources

10. **COURSE POLICIES: STUDENT COMMITMENT**
    - Student-centered approach statement
    - Student choice and flexibility options
    - Diversity, Equity, and Inclusion statement
    - Student Conduct expectations
    - AI Policy (match to instructor's stance)

11. **INSTRUCTOR COMMITMENT**
    - Response time for communications
    - Grading notification expectations
    - Student choice philosophy
    - Openness to feedback

12. **COURSE SCHEDULE** (use week-by-week sections with bold labels)
    - Week number
    - Topics
    - Student Responsibilities (readings, activities, due dates)
    - Note about potential changes

13. **CLASS CANCELLATIONS**
    - BSU notification procedure

IMPORTANT FORMATTING NOTES:
- Use a warm, encouraging, partnership tone throughout
- Be learner-centered rather than instructor-centered
- Include UDL principles where appropriate
- Make policies clear but supportive, not punitive
- Ready to paste into Blackboard Ultra or Word document`,

    schedule: `${baseContext}

Create a COMPREHENSIVE course schedule with ACTUAL CALENDAR DATES:
1. Week-by-week breakdown with specific dates
2. Topics and learning objectives
3. Readings and materials
4. Assignments with due dates
5. Assessment schedule
6. Account for breaks and holidays

**INCLUSIVE DESIGN CONSIDERATIONS** (integrate into the schedule):
7. **UDL Pacing**: Build in flexibility, avoid clustering too many deadlines
8. **Cultural Awareness**: Note major religious/cultural observances, consider diverse heritage months
9. **SEL-Informed Timing**: Include lighter weeks after intensive periods, build in check-in points for student wellbeing

Course Dates: ${toolData.startDate} to ${toolData.endDate}
Format: ${toolData.courseFormat}
Duration: ${toolData.numberOfWeeks} weeks
Meeting Pattern: ${toolData.meetingPattern}
Meeting Days: ${toolData.meetingDays || "Not specified"}
Major Topics: ${toolData.majorTopics}
Assessments: ${toolData.assessments}
Additional Context: ${toolData.additionalContext || "None"}`,

    aipolicy: `${baseContext}

Create an AI USE POLICY for this course following BSU's AI Policy Framework.

INSTRUCTOR'S STANCE: ${toolData.aiStance}

AI TOOLS TO ADDRESS:
${toolData.aiTools?.map((tool: string) => `- ${tool}`).join("\n") || "General AI tools"}

KEY ASSIGNMENTS:
${toolData.keyAssignments}

PRIMARY CONCERNS:
${toolData.concerns?.map((c: string) => `- ${c}`).join("\n") || "General concerns"}

ADDITIONAL CONTEXT: ${toolData.additionalContext || "None"}

BSU uses a 4-LEVEL AI POLICY FRAMEWORK (adapted from Leon Furze's AI Assessment Scale v2):

**Policy 1: No AI** - No AI tools allowed for any assessments, assignments, or studying
**Policy 2: AI for Planning** - AI allowed for brainstorming and planning only, not for creating content
**Policy 3: AI for Collaboration** - AI may assist with drafting/revising, but student must critically evaluate and modify all AI content
**Policy 4: Full AI** - AI may be used extensively; focus is on directing AI effectively and demonstrating critical thinking

Based on the instructor's stance, create a policy that includes:

1. **POLICY STATEMENT**
   - Clear statement matching one of the 4 levels (or a hybrid approach)
   - Written in student-friendly, supportive language

2. **RATIONALE**
   - Pedagogical reasoning for this policy level
   - How this supports the learning outcomes

3. **ASSIGNMENT-SPECIFIC MATRIX** (if stance varies by assignment)
   - List showing which policy level applies to each assignment type (use bold labels or an accessible HTML table)
   - Clear guidance for different activities

4. **PERMITTED USES** (specific examples)
   - What students CAN do with AI in this course
   - Concrete examples relevant to course content

5. **PROHIBITED USES** (specific examples)
   - What is NOT allowed
   - Clear boundaries

6. **CITATION REQUIREMENTS**
   - How to acknowledge AI use (matching BSU style)
   - Examples: "Initial brainstorming supported by [AI tool]" or "Draft revision suggestions provided by [AI tool], modified for final submission"
   - Reference to Maxwell Library's AI citation resources

7. **ACADEMIC INTEGRITY**
   - Connection to BSU's academic integrity policies
   - Consequences for policy violations

8. **EQUITY CONSIDERATIONS**
   - Acknowledgment that not all students have equal AI access
   - How this is addressed in the policy

9. **SUPPORT RESOURCES**
   - Alternatives to AI for getting help
   - BSU tutoring, writing center, office hours

10. **FAQ SECTION**
    - Common student questions
    - Practical scenarios

Make the policy:
- Warm and educational in tone (not punitive)
- Specific enough to be enforceable
- Ready to paste into syllabus or Blackboard
- Aligned with BSU's TTC guidelines`,

    alignment: `${baseContext}

Perform a DETAILED ALIGNMENT ANALYSIS between learning outcomes and assessments.

COURSE LEARNING OUTCOMES:
${toolData.learningOutcomes}

ASSIGNMENTS AND ASSESSMENTS:
${toolData.assignments}

ANALYSIS REQUESTED:
${toolData.checkType?.map((c: string) => `- ${c}`).join("\n") || "Full alignment check"}

ADDITIONAL CONTEXT: ${toolData.additionalContext || "None"}

Please provide:
1. **Alignment Matrix** - Show which assignments assess which outcomes (use an accessible HTML table with caption, thead, and th scope, or bullet points with bold labels)
2. **Coverage Analysis** - Are all outcomes adequately assessed?
3. **Gap Identification** - Any outcomes not assessed or under-assessed
4. **Overlap Analysis** - Outcomes assessed multiple times (is this intentional/appropriate?)
5. **Bloom's Taxonomy Analysis** - What cognitive levels are assignments targeting?
6. **Recommendations** - Specific suggestions to improve alignment
7. **Strengths** - What's working well in the current design

**INCLUSIVE DESIGN ANALYSIS** (include as a dedicated section):
8. **UDL Assessment**: Are there multiple ways for students to demonstrate mastery of each outcome?
9. **Cultural Responsiveness**: Do assessments allow for diverse perspectives and ways of knowing?
10. **SEL Integration**: Are there opportunities for reflection, collaboration, and growth mindset throughout?
11. **Equity Considerations**: Any barriers that might disadvantage certain student populations?

Format the matrix clearly so it can be used for accreditation documentation or course improvement.`,

    grading: `${baseContext}

Design an EQUITABLE GRADING POLICY based on Grading for Equity principles (Joe Feldman) that measures student content knowledge rather than compliance behaviors.

CURRENT GRADING APPROACH:
${toolData.currentGradingApproach || "Not specified - design a new system from scratch"}

GRADING PHILOSOPHY GOALS:
${toolData.gradingPhilosophy?.map((g: string) => `- ${g}`).join("\n") || "Focus on content mastery"}

ASSESSMENT TYPES IN COURSE:
${toolData.assessmentTypes?.map((a: string) => `- ${a}`).join("\n") || "Various assessments"}

CURRENT CHALLENGES:
${toolData.challenges?.map((c: string) => `- ${c}`).join("\n") || "None specified"}

CONSTRAINTS:
${toolData.constraints || "None specified"}

ADDITIONAL CONTEXT: ${toolData.additionalContext || "None"}

Create a comprehensive grading policy that includes:

1. **GRADING PHILOSOPHY STATEMENT**
   - Clear statement of the grading approach and its pedagogical foundation
   - How this system measures content knowledge, not compliance
   - Connection to research on equitable grading

2. **GRADE BREAKDOWN**
   - Recommended percentage weights for assessment categories
   - Rationale for each weight
   - How this distribution prioritizes learning over compliance

3. **LATE WORK POLICY** (Equitable Approach)
   - Policy that doesn't penalize students for life circumstances
   - Options: grace periods, dropped lowest scores, revision windows
   - How to maintain accountability without punitive measures
   - Sample language for syllabus

4. **REVISION AND RESUBMISSION POLICY**
   - How students can demonstrate improved mastery
   - Clear process for resubmission
   - What qualifies for revision opportunities
   - Grading of revised work

5. **PARTICIPATION/ATTENDANCE** (If applicable)
   - Why traditional participation grades may be inequitable
   - Alternative approaches that measure engagement without penalizing:
     * Introverted students
     * Students with disabilities
     * Students with work/family obligations
   - Engagement alternatives if participation is important

6. **MINIMUM GRADING POLICY** (Optional but recommended)
   - Why 50% minimums can be more equitable than 0%
   - How to implement minimum grading
   - Addressing concerns about "giving away points"

7. **GRADING SCALE**
   - Recommended scale (traditional A-F or alternative)
   - Clear criteria for each grade level
   - Connection to learning outcomes

8. **EXTRA CREDIT** (Equitable Approach)
   - Why some extra credit policies are inequitable
   - If offering extra credit, how to make it accessible to all
   - Alternatives to traditional extra credit

9. **TRANSPARENCY AND FEEDBACK**
   - How grades will be communicated
   - Frequency and type of feedback
   - How students can track their progress
   - Clear rubrics and expectations

10. **SAMPLE SYLLABUS LANGUAGE**
    - Ready-to-use policy text for the syllabus
    - Student-friendly explanation of the approach

**INCLUSIVE DESIGN CONSIDERATIONS** (dedicated section):

11. **UDL in Assessment**
    - Multiple ways to demonstrate mastery
    - Flexible deadlines and formats where possible
    - Reducing barriers to showing knowledge

12. **Culturally Responsive Grading**
    - Avoiding cultural bias in assessment
    - Valuing diverse ways of knowing
    - Considering cultural factors in participation expectations

13. **SEL-Informed Grading**
    - Reducing grade anxiety
    - Supporting growth mindset through grading practices
    - Building trust through fair and transparent policies

14. **ADDRESSING COMMON CONCERNS**
    - FAQ for faculty concerns about equitable grading
    - Research citations supporting these practices
    - How to communicate this approach to students and colleagues

Make the policy:
- Grounded in Grading for Equity research (Joe Feldman)
- Practical and implementable
- Ready to paste into syllabus
- Supportive of student learning while maintaining rigor`,

    airesistant: `${baseContext}

You are an expert in academic integrity and authentic assessment design. Analyze the following assignment for its vulnerability to AI-generated completion, and provide specific, research-based strategies to make it more AI-resistant while maintaining educational value.

EXISTING ASSIGNMENT:
${toolData.existingAssignment}

ASSIGNMENT TYPE: ${toolData.assignmentType}

ANALYSIS REQUESTED:
${toolData.whatYouWant?.map((w: string) => `- ${w}`).join("\n") || "Full analysis"}

CONSTRAINTS TO CONSIDER:
${toolData.constraints?.map((c: string) => `- ${c}`).join("\n") || "None specified"}

ADDITIONAL CONTEXT: ${toolData.additionalContext || "None"}

Provide a comprehensive analysis with the following sections:

## 1. AI VULNERABILITY ASSESSMENT

**Vulnerability Score: [LOW / MEDIUM / HIGH / VERY HIGH]**

Analyze how easily current AI tools (ChatGPT, Claude, etc.) could complete this assignment:

- **What AI can easily do:** Identify specific elements AI would handle well
- **What AI would struggle with:** Elements that require human-specific knowledge or skills
- **Red flags for detection:** What would indicate AI-generated work
- **Likelihood of detection:** How likely would AI use be caught with current detection methods

## 2. VULNERABILITY BREAKDOWN

For each component of the assignment, rate vulnerability and explain:
- Assignment prompt/instructions
- Required content or topics
- Format and length requirements
- Research or citation requirements
- Personal reflection elements (if any)
- Process documentation (if any)

## 3. AI-RESISTANT ENHANCEMENT STRATEGIES

Based on research in authentic assessment and academic integrity, recommend specific changes using these evidence-based strategies:

**Personal & Lived Experience Integration**
- How to incorporate personal reflection, local observations, or lived experience
- Specific prompts that require authentic human experience

**Process Documentation Requirements**
- How to require drafts, research logs, or revision notes
- Ways to make the thinking process visible

**Hyperlocal & Current Content**
- Connecting to specific class discussions, campus events, or local issues
- Using recent or unpublished sources AI wouldn't know

**Multimodal Evidence**
- Adding photos, recordings, or physical artifacts
- Requiring evidence of real-world engagement

**Oral Defense or Presentation Components**
- Adding brief verbal explanation requirements
- How to implement efficiently in various course sizes

**Iterative Peer Collaboration**
- Building in peer feedback and response requirements
- Creating accountability through collaboration

**Metacognitive Reflection**
- Specific prompts about struggle, confusion, and learning process
- Questions AI answers generically but humans answer authentically

## 4. REVISED ASSIGNMENT (If Requested)

Provide a rewritten version of the assignment incorporating the recommended AI-resistant features:
- Maintain the original learning objectives
- Add specific elements from the strategies above
- Include clear instructions for any new requirements
- Keep workload reasonable for students

## 5. ALTERNATIVE ASSESSMENT OPTIONS

If a fundamentally different approach would be more AI-resistant, suggest alternatives:
- Different assignment formats that achieve the same learning outcomes
- Portfolio-based alternatives
- Authentic assessment approaches
- Project-based options with built-in authenticity

## 6. DETECTION AND RESPONSE STRATEGIES

Practical guidance for instructors:
- Conversation starters to verify student understanding
- Follow-up questions to ask about submitted work
- Signs of AI-generated content specific to this assignment type
- Recommended approach if AI use is suspected

## 7. STUDENT COMMUNICATION

Draft language for communicating expectations:
- Why AI-resistant elements are included (focus on learning, not punishment)
- What is and isn't allowed
- How to use AI appropriately as a learning tool (if applicable)

**Key Principle:** The goal is authentic assessment that measures genuine student learning, not simply making students' lives harder. Every recommendation should serve the learning objectives while naturally requiring human engagement.

Format all output clearly with headers and bullet points for easy reading.`,

    accessibility: `${accessibilityBaseContext}

Analyze the following course content for accessibility barriers and provide research-based recommendations to make it more inclusive for all learners.

CONTENT TO ANALYZE:
${toolData.contentToAnalyze}

CONTENT TYPE: ${toolData.contentType}

AREAS TO ANALYZE:
${toolData.analysisAreas?.map((a: string) => `- ${a}`).join("\n") || "Full analysis"}

STUDENT POPULATIONS TO CONSIDER:
${toolData.studentPopulation?.map((s: string) => `- ${s}`).join("\n") || "General student population"}

ADDITIONAL CONTEXT: ${toolData.additionalContext || "None"}

Provide a comprehensive accessibility analysis with the following sections. Ground all recommendations in established research and standards:

## 1. ACCESSIBILITY OVERVIEW

**Overall Accessibility Rating: [EXCELLENT / GOOD / NEEDS IMPROVEMENT / SIGNIFICANT BARRIERS]**

Provide a brief summary of the content's current accessibility status, highlighting major strengths and concerns.

## 2. BARRIER IDENTIFICATION

Analyze the content for specific accessibility barriers, organized by category:

**Document Structure & Readability** (Based on WCAG 2.1 Guidelines)
- Heading hierarchy and organization
- Reading level analysis (aim for 8th-10th grade level per plain language guidelines)
- Font and formatting considerations
- Use of color and visual elements

**Cognitive Load & Complexity** (Based on Cognitive Load Theory - Sweller, 2011)
- Information density and chunking
- Clarity of instructions and expectations
- Working memory demands
- Scaffolding and supports provided

**Time & Pacing Considerations** (Based on UDL Guideline 8.2)
- Time requirements and flexibility
- Deadline structures
- Accommodation-friendly pacing

**Format Flexibility** (Based on UDL Principle II: Multiple Means of Representation)
- Alternative format availability
- Modality options (visual, auditory, kinesthetic)
- Representation of information

**Assistive Technology Compatibility** (Based on Section 508 and WCAG standards)
- Screen reader compatibility
- Keyboard navigation requirements
- Compatibility with common assistive technologies

## 3. UDL ALIGNMENT CHECK

Evaluate alignment with CAST's Universal Design for Learning framework:

**Engagement (The "Why" of Learning)**
- Multiple options for recruiting interest (Guideline 7)
- Options for sustaining effort and persistence (Guideline 8)
- Options for self-regulation (Guideline 9)

**Representation (The "What" of Learning)**
- Options for perception (Guideline 1)
- Options for language and symbols (Guideline 2)
- Options for comprehension (Guideline 3)

**Action & Expression (The "How" of Learning)**
- Options for physical action (Guideline 4)
- Options for expression and communication (Guideline 5)
- Options for executive functions (Guideline 6)

## 4. POPULATION-SPECIFIC CONSIDERATIONS

For each student population selected, provide targeted recommendations:
- Specific barriers this population might encounter
- Evidence-based accommodations and modifications
- Proactive design changes to reduce accommodation needs

## 5. IMPROVEMENT RECOMMENDATIONS

Provide specific, actionable improvements organized by priority:

**High Priority (Address Immediately)**
- Changes that remove significant barriers
- Modifications required for legal compliance (ADA, Section 508)

**Medium Priority (Address Soon)**
- Improvements that enhance accessibility for many students
- UDL enhancements that benefit all learners

**Low Priority (Consider for Future)**
- Enhancements that provide additional flexibility
- Innovative accessible design features

## 6. REVISED CONTENT (If Applicable)

If the content is brief enough, provide a revised version incorporating accessibility improvements:
- Clear heading structure
- Simplified language where appropriate
- Built-in flexibility and options
- Explicit accommodations integrated naturally

## 7. ACCESSIBLE DESIGN CHECKLIST

A practical checklist for this type of content:
- [ ] Specific actionable items for accessibility
- [ ] Items organized by category
- [ ] Include both required standards and best practices

## 8. RESEARCH REFERENCES

Cite the research and standards that inform these recommendations:
- WCAG 2.1 Guidelines (Web Content Accessibility Guidelines)
- CAST UDL Guidelines 2.2
- Section 508 Standards
- Relevant cognitive science research (Mayer, Sweller, etc.)
- Disability-specific research as applicable

**Key Principle:** Accessible design benefits ALL learners, not just those with documented disabilities. The goal is to proactively design learning experiences that reduce barriers and provide multiple pathways to success.

Format all output clearly with headers and bullet points for easy reading.`,

    aistudent: `${baseContext}

Design a COMPLETE AI-POWERED STUDENT ACTIVITY where students intentionally use AI as a learning tool. This activity should be grounded in evidence-based AI pedagogy research (EDUCAUSE 2025, Mollick & Mollick 2023, Bowen & Watson 2024, UNESCO 2023).

Create a comprehensive, ready-to-implement activity that includes ALL of the following sections:

## 1. ACTIVITY TITLE AND OVERVIEW
- A clear, engaging title for the activity
- Brief overview explaining what students will do and why AI is being used as a pedagogical tool
- Connection to course learning objectives

## 2. LEARNING OBJECTIVES
- Content-specific learning objectives tied to the course
- AI Literacy objectives (e.g., understanding AI capabilities/limitations, prompt engineering, critical evaluation of AI output)
- Metacognitive objectives (e.g., reflecting on one's own learning process compared to AI-generated responses)
- Reference to Bloom's Taxonomy level(s) targeted

## 3. PREPARATION AND SETUP
- What students need before starting (accounts, readings, prior knowledge)
- Recommended AI tool: ${toolData.aiToolRecommendation || "Any AI Assistant"}
- Brief instructions on how to access and use the AI tool
- Level-appropriate guidance for ${toolData.studentLevel || "Intermediate"} AI users

## 4. STEP-BY-STEP STUDENT INSTRUCTIONS
- Clear, numbered instructions for completing the activity
- Specific AI interaction points clearly marked (e.g., "STEP 3: AI INTERACTION")
- For each AI interaction, provide:
  - Purpose of using AI at this point
  - Sample prompts students can use or adapt
  - What to look for in the AI response
  - How to critically evaluate the output

## 5. CRITICAL THINKING CHECKPOINTS
- Built-in moments where students must pause and evaluate AI output
- Specific questions to guide critical analysis:
  - Is the AI output accurate? How can you verify?
  - What perspectives or information might the AI be missing?
  - How does the AI response compare to course materials?
  - What assumptions is the AI making?
- Encourage students to identify where the AI excels and where it falls short

## 6. REFLECTION AND METACOGNITION COMPONENT
- Structured reflection prompts about the AI-assisted learning process:
  - What did you learn from the AI interaction that you wouldn't have learned on your own?
  - How did working with AI change your understanding of the topic?
  - What did you find the AI got wrong or presented superficially?
  - How would you approach this task differently next time using AI?
- Connection between AI-assisted learning and personal knowledge construction

## 7. SUBMISSION REQUIREMENTS
- What students need to submit
- Documentation of AI interactions (screenshots, conversation logs, or prompt records)
- Format for Blackboard Ultra submission
- Clear expectations for what constitutes "student work" vs. "AI-generated content"

## 8. GRADING CONSIDERATIONS
- How to assess the AI-assisted work fairly
- Emphasis on the student's critical thinking, analysis, and revision — not just the final product
- Suggested evaluation criteria that value the process of working with AI
- How to distinguish between effective AI use and over-reliance

## 9. ETHICAL GUIDELINES
- Clear expectations for responsible AI use in this activity
- Academic integrity considerations specific to AI-assisted work
- Privacy and data considerations when using AI tools
- Acknowledgment and citation of AI contributions

## 10. INSTRUCTOR NOTES
- Tips for facilitating this activity
- Common student challenges and how to address them
- Variations for different class sizes or formats (in-person, online, hybrid)
- How this activity builds AI literacy skills progressively

Activity Type: ${toolData.activityType}
Learning Objectives: ${toolData.learningObjectives}
Recommended AI Tool: ${toolData.aiToolRecommendation || "Any AI Assistant"}
Student AI Experience Level: ${toolData.studentLevel || "Intermediate"}
Critical Thinking Focus Areas: ${toolData.criticalThinkingFocus?.join(", ") || "General critical thinking"}
Activity Guardrails: ${toolData.guardrails?.join(", ") || "Standard guardrails"}
Additional Context: ${toolData.additionalContext || "None"}`,
  };

  return prompts[toolId] || baseContext;
}

async function fixVagueLinkTextAI(text: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `You are an accessibility editor. Your task is to fix vague link text in the following markdown content.

Vague link text includes phrases like "click here", "here", "link", or similar non-descriptive labels.

Rules:
1. For each vague link that has a URL, replace ONLY the link label with a short, descriptive phrase that accurately reflects the link destination based on surrounding context. Preserve the URL exactly as-is.
   - Example: \`[click here](https://bsu.edu/calendar)\` → \`[BSU Academic Calendar](https://bsu.edu/calendar)\`
2. For vague links with NO URL (bare links like \`[click here]\` or \`[here]\`), replace the entire link with the editorial placeholder: \`[** Describe link destination **]\`
3. Do NOT change any other content — only fix the vague link labels.
4. Return the complete updated markdown with no additional commentary, explanations, or code fences.

Here is the markdown content to fix:

${text}`,
      },
    ],
  });

  const result = message.content
    .filter((item): item is Anthropic.TextBlock => item.type === "text")
    .map((item) => item.text)
    .join("");

  const trimmed = result.trim();
  if (!trimmed) {
    throw new Error("AI returned an empty response for vague link fix; original content preserved.");
  }
  return trimmed;
}

function fixAllCaps(text: string): string {
  return text.replace(/\b[A-Z]{10,}\b/g, (match) => {
    return match.charAt(0).toUpperCase() + match.slice(1).toLowerCase();
  });
}

/**
 * Finds the first heading level skip in the content and inserts a placeholder
 * heading at the missing level to maintain a logical hierarchy.
 */
function fixHeadingSkip(text: string): string {
  const lines = text.split("\n");
  const headings: Array<{ lineIdx: number; level: number }> = [];
  let insideCodeFence = false;

  lines.forEach((line, lineIdx) => {
    if (/^```/.test(line.trim())) insideCodeFence = !insideCodeFence;
    if (!insideCodeFence) {
      const match = line.match(/^(#{1,6})\s/);
      if (match) headings.push({ lineIdx, level: match[1].length });
    }
  });

  if (headings.length <= 1) return text;

  let prevLevel = headings[0].level;
  for (let h = 1; h < headings.length; h++) {
    const { level, lineIdx } = headings[h];
    if (level > prevLevel + 1) {
      const missingLevel = prevLevel + 1;
      const hashes = "#".repeat(missingLevel);
      lines.splice(lineIdx, 0, `${hashes} Section`);
      break;
    }
    prevLevel = level;
  }

  return lines.join("\n");
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // Setup authentication (before other routes)
  await setupAuth(app);
  registerAuthRoutes(app);

  const getAdminIds = () => (process.env.ADMIN_USER_IDS || "").split(",").map(id => id.trim()).filter(Boolean);

  const checkIsAdmin = (req: Request): boolean => {
    const userId = getUserId(req);
    const userEmail = (req.user as any)?.claims?.email as string | undefined;
    const adminIds = getAdminIds();
    return !!(userId && adminIds.some(entry => entry === userId || entry === userEmail));
  };

  const isAdmin = (req: Request, res: Response, next: Function) => {
    if (!checkIsAdmin(req)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };

  app.get("/api/config", (_req: Request, res: Response) => {
    res.json({ versionHistoryLimit: VERSION_HISTORY_LIMIT });
  });

  app.get("/api/deterministic-fixers", (_req: Request, res: Response) => {
    res.json({ keys: getDeterministicFixerKeys().sort() });
  });

  app.get("/api/admin/check", isAuthenticated, (req: Request, res: Response) => {
    res.json({ isAdmin: checkIsAdmin(req) });
  });

  app.post(
    "/api/admin/send-summary",
    isAuthenticated,
    isAdmin,
    async (_req: Request, res: Response) => {
      try {
        const { sendDailySummary } = await import("./lib/daily-summary.js");
        await sendDailySummary();
        res.json({ ok: true, message: "Summary email sent." });
      } catch (err: any) {
        res.status(500).json({ ok: false, message: err.message || "Failed to send summary email." });
      }
    },
  );

  app.get(
    "/api/admin/stats",
    isAuthenticated,
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        const now = new Date();
        const months: string[] = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
        }

        const [
          totalCoursesResult,
          totalContentResult,
          totalConversionsResult,
          totalUsersResult,
          activeUsersResult,
          monthlyCoursesResult,
          monthlyContentResult,
          monthlyConversionsResult,
          toolBreakdownResult,
          conversionStatusResult,
          ocrUsageResult,
          recentCoursesResult,
          recentContentResult,
          userActivityResult,
          refinementsResult,
          aiAccessibilityChecksResult,
          conversionsWithReportResult,
          avgFinalScoreResult,
          avgOriginalScoreResult,
          totalIssuesResult,
          totalFixedResult,
        ] = await Promise.all([
          db.select({ count: sql<number>`count(*)` }).from(courses),
          db.select({ count: sql<number>`count(*)` }).from(generatedContent),
          db.select({ count: sql<number>`count(*)` }).from(conversions),
          db.select({ count: sql<number>`count(*)` }).from(users),
          db.select({ count: sql<number>`count(*)` }).from(sql`(
            SELECT DISTINCT user_id FROM courses WHERE to_char(created_at, 'YYYY-MM') = ${months[5]} AND user_id IS NOT NULL
            UNION
            SELECT DISTINCT user_id FROM generated_content WHERE to_char(created_at, 'YYYY-MM') = ${months[5]} AND user_id IS NOT NULL
            UNION
            SELECT DISTINCT user_id FROM conversions WHERE to_char(created_at, 'YYYY-MM') = ${months[5]} AND user_id IS NOT NULL
          ) AS active_users`),
          db.select({
            month: sql<string>`to_char(created_at, 'YYYY-MM')`,
            count: sql<number>`count(*)`,
          }).from(courses)
            .where(sql`to_char(created_at, 'YYYY-MM') >= ${months[0]} AND to_char(created_at, 'YYYY-MM') <= ${months[5]}`)
            .groupBy(sql`to_char(created_at, 'YYYY-MM')`),
          db.select({
            month: sql<string>`to_char(created_at, 'YYYY-MM')`,
            count: sql<number>`count(*)`,
          }).from(generatedContent)
            .where(sql`to_char(created_at, 'YYYY-MM') >= ${months[0]} AND to_char(created_at, 'YYYY-MM') <= ${months[5]}`)
            .groupBy(sql`to_char(created_at, 'YYYY-MM')`),
          db.select({
            month: sql<string>`to_char(created_at, 'YYYY-MM')`,
            count: sql<number>`count(*)`,
          }).from(conversions)
            .where(sql`to_char(created_at, 'YYYY-MM') >= ${months[0]} AND to_char(created_at, 'YYYY-MM') <= ${months[5]}`)
            .groupBy(sql`to_char(created_at, 'YYYY-MM')`),
          db.select({
            toolName: generatedContent.toolName,
            count: sql<number>`count(*)`,
          }).from(generatedContent)
            .groupBy(generatedContent.toolName)
            .orderBy(sql`count(*) desc`),
          db.select({
            status: conversions.status,
            count: sql<number>`count(*)`,
          }).from(conversions)
            .groupBy(conversions.status),
          db.select({ count: sql<number>`count(*)` })
            .from(conversions)
            .where(sql`ocr_applied = true`),
          db.select({
            id: courses.id,
            courseName: courses.courseName,
            courseNumber: courses.courseNumber,
            userId: courses.userId,
            createdAt: courses.createdAt,
          }).from(courses)
            .orderBy(desc(courses.createdAt))
            .limit(10),
          db.select({
            id: generatedContent.id,
            toolName: generatedContent.toolName,
            courseId: generatedContent.courseId,
            userId: generatedContent.userId,
            createdAt: generatedContent.createdAt,
          }).from(generatedContent)
            .orderBy(desc(generatedContent.createdAt))
            .limit(10),
          db.select({
            userId: sql<string>`user_id`,
          }).from(sql`(
            SELECT user_id FROM courses WHERE user_id IS NOT NULL
            UNION
            SELECT user_id FROM generated_content WHERE user_id IS NOT NULL
            UNION
            SELECT user_id FROM conversions WHERE user_id IS NOT NULL
          ) AS all_users`)
            .groupBy(sql`user_id`),
          db.select({ count: sql<number>`count(*)` }).from(contentVersions),
          db.select({ count: sql<number>`count(*)` }).from(generatedContent)
            .where(sql`tool_type = 'accessibility'`),
          db.select({ count: sql<number>`count(*)` }).from(conversions)
            .where(sql`status = 'completed' AND compliance_report IS NOT NULL`),
          db.select({ avg: sql<string>`avg((compliance_report->>'overallScore')::numeric)` }).from(conversions)
            .where(sql`status = 'completed' AND compliance_report IS NOT NULL`),
          db.select({ avg: sql<string>`avg((original_compliance_report->>'overallScore')::numeric)` }).from(conversions)
            .where(sql`status = 'completed' AND compliance_report IS NOT NULL AND original_compliance_report IS NOT NULL`),
          db.select({ total: sql<string>`coalesce(sum((compliance_report->>'totalIssues')::integer), 0)` }).from(conversions)
            .where(sql`status = 'completed' AND compliance_report IS NOT NULL`),
          db.select({ total: sql<string>`coalesce(sum((compliance_report->>'fixedCount')::integer), 0)` }).from(conversions)
            .where(sql`status = 'completed' AND compliance_report IS NOT NULL`),
        ]);

        const allActiveUserIds = userActivityResult.map(u => u.userId).filter(Boolean);

        const userIds = [...new Set([
          ...recentCoursesResult.map(c => c.userId),
          ...recentContentResult.map(c => c.userId).filter((id): id is string => id !== null),
          ...allActiveUserIds,
        ])].filter((id): id is string => id !== null);

        const userLookup: Record<string, { firstName: string | null; lastName: string | null; email: string | null }> = {};
        if (userIds.length > 0) {
          const usersData = await db.select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
          }).from(users)
            .where(inArray(users.id, userIds));
          for (const u of usersData) {
            userLookup[u.id] = { firstName: u.firstName, lastName: u.lastName, email: u.email };
          }
        }

        const courseCountByUser = await db.select({
          userId: courses.userId,
          count: sql<number>`count(*)`,
        }).from(courses)
          .groupBy(courses.userId);
        const coursesByUser: Record<string, number> = {};
        for (const row of courseCountByUser) {
          coursesByUser[row.userId] = Number(row.count);
        }

        const contentCountByUser = await db.select({
          userId: generatedContent.userId,
          count: sql<number>`count(*)`,
        }).from(generatedContent)
          .where(sql`${generatedContent.userId} IS NOT NULL`)
          .groupBy(generatedContent.userId);
        const contentByUser: Record<string, number> = {};
        for (const row of contentCountByUser) {
          if (row.userId) contentByUser[row.userId] = Number(row.count);
        }

        const convCountByUser = await db.select({
          userId: conversions.userId,
          count: sql<number>`count(*)`,
        }).from(conversions)
          .where(sql`${conversions.userId} IS NOT NULL`)
          .groupBy(conversions.userId);
        const convByUser: Record<string, number> = {};
        for (const row of convCountByUser) {
          if (row.userId) convByUser[row.userId] = Number(row.count);
        }

        const monthlyTrends = months.map(m => {
          const c = monthlyCoursesResult.find(r => r.month === m);
          const g = monthlyContentResult.find(r => r.month === m);
          const d = monthlyConversionsResult.find(r => r.month === m);
          return {
            month: m,
            courses: Number(c?.count ?? 0),
            content: Number(g?.count ?? 0),
            conversions: Number(d?.count ?? 0),
          };
        });

        const statusMap: Record<string, number> = {};
        for (const row of conversionStatusResult) {
          statusMap[row.status] = Number(row.count);
        }

        res.json({
          summary: {
            totalCourses: Number(totalCoursesResult[0]?.count ?? 0),
            totalContent: Number(totalContentResult[0]?.count ?? 0),
            totalConversions: Number(totalConversionsResult[0]?.count ?? 0),
            totalUsers: Number(totalUsersResult[0]?.count ?? 0),
            activeUsersThisMonth: Number(activeUsersResult[0]?.count ?? 0),
            totalRefinements: Number(refinementsResult[0]?.count ?? 0),
          },
          monthlyTrends,
          toolBreakdown: toolBreakdownResult.map(t => ({
            name: t.toolName,
            count: Number(t.count),
          })),
          conversionStats: {
            byStatus: statusMap,
            ocrUsed: Number(ocrUsageResult[0]?.count ?? 0),
          },
          recentCourses: recentCoursesResult.map(c => ({
            ...c,
            user: userLookup[c.userId] || null,
          })),
          recentContent: recentContentResult.map(c => ({
            ...c,
            user: c.userId ? userLookup[c.userId] || null : null,
          })),
          userActivity: allActiveUserIds.map(uid => ({
            userId: uid,
            user: userLookup[uid] || null,
            courseCount: coursesByUser[uid] || 0,
            contentCount: contentByUser[uid] || 0,
            conversionCount: convByUser[uid] || 0,
          })).sort((a, b) => (b.courseCount + b.contentCount + b.conversionCount) - (a.courseCount + a.contentCount + a.conversionCount)),
          accessibilityStats: (() => {
            const found = Number(totalIssuesResult[0]?.total ?? 0);
            const fixed = Number(totalFixedResult[0]?.total ?? 0);
            return {
              aiChecksRun: Number(aiAccessibilityChecksResult[0]?.count ?? 0),
              conversionsWithReport: Number(conversionsWithReportResult[0]?.count ?? 0),
              avgFinalScore: avgFinalScoreResult[0]?.avg != null ? Math.round(Number(avgFinalScoreResult[0].avg)) : null,
              avgOriginalScore: avgOriginalScoreResult[0]?.avg != null ? Math.round(Number(avgOriginalScoreResult[0].avg)) : null,
              totalIssuesFound: found,
              totalIssuesFixed: fixed,
              totalIssuesRemaining: Math.max(0, found - fixed),
            };
          })(),
        });
      } catch (error) {
        console.error("Error fetching admin stats:", error);
        res.status(500).json({ error: "Failed to fetch admin stats" });
      }
    },
  );

  app.get(
    "/api/stats/public",
    async (req: Request, res: Response) => {
      try {
        const apiKey = process.env.STATS_API_KEY;
        if (apiKey && req.headers["x-api-key"] !== apiKey) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        const now = new Date();
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

        const [coursesResult, contentResult, conversionsResult, accessibilityChecksResult] = await Promise.all([
          db.select({ count: sql<number>`count(*)` })
            .from(courses)
            .where(sql`to_char(created_at, 'YYYY-MM') = ${month}`),
          db.select({ count: sql<number>`count(*)` })
            .from(generatedContent)
            .where(sql`to_char(created_at, 'YYYY-MM') = ${month}`),
          db.select({ count: sql<number>`count(*)` })
            .from(conversions)
            .where(sql`to_char(created_at, 'YYYY-MM') = ${month}`),
          db.select({ count: sql<number>`count(*)` })
            .from(conversions)
            .where(sql`to_char(created_at, 'YYYY-MM') = ${month} AND compliance_report IS NOT NULL`),
        ]);

        res.json({
          month,
          coursesCreated: Number(coursesResult[0]?.count ?? 0),
          contentGenerated: Number(contentResult[0]?.count ?? 0),
          documentsConverted: Number(conversionsResult[0]?.count ?? 0),
          accessibilityChecksRun: Number(accessibilityChecksResult[0]?.count ?? 0),
          totalActivity:
            Number(coursesResult[0]?.count ?? 0) +
            Number(contentResult[0]?.count ?? 0) +
            Number(conversionsResult[0]?.count ?? 0),
        });
      } catch (error) {
        console.error("Error fetching stats:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
      }
    },
  );

  // Courses API (protected)
  app.get(
    "/api/courses",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const courses = await storage.getAllCourses(userId);
        res.json(courses);
      } catch (error) {
        console.error("Error fetching courses:", error);
        res.status(500).json({ error: "Failed to fetch courses" });
      }
    },
  );

  app.get(
    "/api/courses/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const id = parseInt(req.params.id as string);
        const course = await storage.getCourse(id, userId);
        if (!course) {
          return res.status(404).json({ error: "Course not found" });
        }
        res.json(course);
      } catch (error) {
        console.error("Error fetching course:", error);
        res.status(500).json({ error: "Failed to fetch course" });
      }
    },
  );

  app.post(
    "/api/courses",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const parsed = insertCourseSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: parsed.error.message });
        }
        const course = await storage.createCourse(parsed.data, userId);
        res.status(201).json(course);
      } catch (error) {
        console.error("Error creating course:", error);
        res.status(500).json({ error: "Failed to create course" });
      }
    },
  );

  app.patch(
    "/api/courses/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const id = parseInt(req.params.id as string);
        // Validate partial course data
        const partialSchema = insertCourseSchema.partial();
        const parsed = partialSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: parsed.error.message });
        }
        const course = await storage.updateCourse(id, parsed.data, userId);
        if (!course) {
          return res.status(404).json({ error: "Course not found" });
        }
        res.json(course);
      } catch (error) {
        console.error("Error updating course:", error);
        res.status(500).json({ error: "Failed to update course" });
      }
    },
  );

  app.delete(
    "/api/courses/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const id = parseInt(req.params.id as string);
        await storage.deleteCourse(id, userId);
        res.status(204).send();
      } catch (error) {
        console.error("Error deleting course:", error);
        res.status(500).json({ error: "Failed to delete course" });
      }
    },
  );

  // Generated Content API (protected with ownership verification)
  app.get(
    "/api/courses/:id/content",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const courseId = parseInt(req.params.id as string);

        // Verify course ownership
        const course = await storage.getCourse(courseId, userId);
        if (!course) {
          return res.status(404).json({ error: "Course not found" });
        }

        const content = await storage.getContentByCourse(courseId);
        res.json(content);
      } catch (error) {
        console.error("Error fetching content:", error);
        res.status(500).json({ error: "Failed to fetch content" });
      }
    },
  );

  app.get(
    "/api/content/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const id = parseInt(req.params.id as string);
        const content = await storage.getContent(id);
        if (!content) {
          return res.status(404).json({ error: "Content not found" });
        }

        if (content.courseId) {
          const course = await storage.getCourse(content.courseId, userId);
          if (!course) {
            return res.status(404).json({ error: "Content not found" });
          }
        } else if (content.userId !== userId) {
          return res.status(404).json({ error: "Content not found" });
        }

        res.json(content);
      } catch (error) {
        console.error("Error fetching content:", error);
        res.status(500).json({ error: "Failed to fetch content" });
      }
    },
  );

  // Toggle content approval for connected materials
  app.patch(
    "/api/content/:id/approval",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const id = parseInt(req.params.id as string);
        const { isApproved } = req.body;

        if (typeof isApproved !== "boolean") {
          return res
            .status(400)
            .json({ error: "isApproved must be a boolean" });
        }

        const content = await storage.getContent(id);
        if (!content) {
          return res.status(404).json({ error: "Content not found" });
        }
        if (content.courseId) {
          const course = await storage.getCourse(content.courseId, userId);
          if (!course) {
            return res.status(404).json({ error: "Content not found" });
          }
        } else if (content.userId !== userId) {
          return res.status(404).json({ error: "Content not found" });
        }

        const updated = await storage.toggleContentApproval(id, isApproved);
        res.json(updated);
      } catch (error) {
        console.error("Error toggling content approval:", error);
        res.status(500).json({ error: "Failed to toggle approval" });
      }
    },
  );

  // Generate content using AI
  app.post(
    "/api/courses/:id/generate",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const courseId = parseInt(req.params.id as string);
        const { toolId, toolName, formData } = req.body;

        const course = await storage.getCourse(courseId, userId);
        if (!course) {
          return res.status(404).json({ error: "Course not found" });
        }

        if (!checkAiGenRateLimit(userId)) {
          return res.status(429).json({ error: "AI generation rate limit exceeded. Please try again later." });
        }

        const prompt = generatePrompt(toolId, formData, course);

        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 8192,
          messages: [{ role: "user", content: prompt }],
        });

        const rawGeneratedText = message.content
          .filter((item): item is Anthropic.TextBlock => item.type === "text")
          .map((item) => item.text)
          .join("\n\n");

        const generatedText = convertMarkdownTablesToHtml(rawGeneratedText);

        const content = await storage.createContent({
          courseId,
          toolType: toolId,
          toolName,
          formData,
          content: generatedText,
        });

        res.status(201).json(content);
      } catch (error) {
        console.error("Error generating content:", error);
        res.status(500).json({ error: "Failed to generate content" });
      }
    },
  );

  app.post(
    "/api/generate-standalone",
    optionalAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const { toolId, toolName, formData } = req.body;

        if (!userId) {
          const ip = req.ip || req.socket.remoteAddress || "unknown";
          if (!checkAnonRateLimit(ip)) {
            return res
              .status(429)
              .json({
                error:
                  "Rate limit exceeded. Please sign in for unlimited access or try again later.",
              });
          }
        } else {
          if (!checkAiGenRateLimit(userId)) {
            return res.status(429).json({ error: "AI generation rate limit exceeded. Please try again later." });
          }
        }

        const allowedTools = [
          "assignment",
          "rubric",
          "alignment",
          "airesistant",
          "accessibility",
          "aistudent",
        ];
        if (!allowedTools.includes(toolId)) {
          return res.status(400).json({ error: "This tool requires a course" });
        }

        const prompt = generatePrompt(toolId, formData, null);

        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 8192,
          messages: [{ role: "user", content: prompt }],
        });

        const rawGeneratedTextStandalone = message.content
          .filter((item): item is Anthropic.TextBlock => item.type === "text")
          .map((item) => item.text)
          .join("\n\n");

        const generatedText = convertMarkdownTablesToHtml(rawGeneratedTextStandalone);

        if (userId) {
          const content = await storage.createContent({
            courseId: null,
            userId,
            toolType: toolId,
            toolName,
            formData,
            content: generatedText,
          });
          return res.status(201).json(content);
        }

        res.status(201).json({
          id: null,
          courseId: null,
          userId: null,
          toolType: toolId,
          toolName,
          formData,
          content: generatedText,
          isApproved: false,
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Error generating standalone content:", error);
        res.status(500).json({ error: "Failed to generate content" });
      }
    },
  );

  // Get standalone content for user
  app.get(
    "/api/standalone-content",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const content = await storage.getStandaloneContent(userId);
        res.json(content);
      } catch (error) {
        console.error("Error fetching standalone content:", error);
        res.status(500).json({ error: "Failed to fetch content" });
      }
    },
  );

  // Get single standalone content item
  app.get(
    "/api/standalone-content/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const id = parseInt(req.params.id as string);
        const content = await storage.getStandaloneContentById(id, userId);
        if (!content) {
          return res.status(404).json({ error: "Content not found" });
        }
        res.json(content);
      } catch (error) {
        console.error("Error fetching standalone content:", error);
        res.status(500).json({ error: "Failed to fetch content" });
      }
    },
  );

  // Refine content
  app.post(
    "/api/content/:id/refine",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const id = parseInt(req.params.id as string);
        const { refinementRequest } = req.body;

        const content = await storage.getContent(id);
        if (!content) {
          return res.status(404).json({ error: "Content not found" });
        }

        if (content.courseId) {
          const course = await storage.getCourse(content.courseId, userId);
          if (!course) {
            return res.status(404).json({ error: "Content not found" });
          }
        } else if (content.userId !== userId) {
          return res.status(404).json({ error: "Content not found" });
        }

        if (!checkAiGenRateLimit(userId)) {
          return res.status(429).json({ error: "AI generation rate limit exceeded. Please try again later." });
        }

        // Save current version
        await storage.createVersion({
          generatedContentId: id,
          content: content.content,
          refinementRequest: "Previous version",
        });
        await storage.pruneOldVersions(id, VERSION_HISTORY_LIMIT);

        const refinementPrompt = `You previously generated the following ${content.toolName} content:

PREVIOUS VERSION:
${content.content}

REFINEMENT REQUEST:
${refinementRequest}

Please generate an IMPROVED version that incorporates the requested changes while maintaining quality and comprehensiveness.`;

        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 8192,
          messages: [{ role: "user", content: refinementPrompt }],
        });

        const rawRefinedText = message.content
          .filter((item): item is Anthropic.TextBlock => item.type === "text")
          .map((item) => item.text)
          .join("\n\n");

        const refinedText = convertMarkdownTablesToHtml(rawRefinedText);

        const updated = await storage.updateContent(id, refinedText);
        res.json(updated);
      } catch (error) {
        console.error("Error refining content:", error);
        res.status(500).json({ error: "Failed to refine content" });
      }
    },
  );

  // Preview what an accessibility fix will change (dry-run, no save)
  app.post(
    "/api/content/:id/preview-fix",
    optionalAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id as string);
        const { fixType } = req.body;
        if (!fixType) {
          return res.status(400).json({ error: "fixType is required" });
        }

        const content = await storage.getContent(id);
        if (!content) {
          return res.status(404).json({ error: "Content not found" });
        }

        const userId = getUserId(req);
        if (content.courseId) {
          if (!userId) return res.status(403).json({ error: "Unauthorized" });
          const course = await storage.getCourse(content.courseId, userId);
          if (!course) return res.status(404).json({ error: "Content not found" });
        } else if (content.userId && content.userId !== userId) {
          return res.status(403).json({ error: "Unauthorized" });
        }

        let fixedContent = content.content;

        if (fixType === "convert-markdown-tables") {
          fixedContent = convertMarkdownTablesToHtml(content.content);
        } else if (fixType === "fix-heading-skip") {
          fixedContent = fixHeadingSkip(content.content);
        } else if (fixType === "fix-vague-link-text") {
          const rateLimitKey = userId ?? (req.ip || req.socket.remoteAddress || "unknown");
          const rateLimitFn = userId ? checkAiGenRateLimit : checkAnonRateLimit;
          if (!rateLimitFn(rateLimitKey)) {
            return res.status(429).json({ error: "Rate limit exceeded. Please try again later." });
          }
          fixedContent = await fixVagueLinkTextAI(content.content);
        } else if (fixType === "fix-all-caps") {
          fixedContent = fixAllCaps(content.content);
        } else {
          return res.status(400).json({ error: "Unknown fix type" });
        }

        res.json({ before: content.content, after: fixedContent });
      } catch (error) {
        console.error("Error previewing accessibility fix:", error);
        res.status(500).json({ error: "Failed to preview fix" });
      }
    },
  );

  // Fix accessibility issue in-place
  app.post(
    "/api/content/:id/fix-accessibility",
    optionalAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id as string);
        const { fixType, captionText, captionTexts, captionIndex } = req.body;
        if (!fixType) {
          return res.status(400).json({ error: "fixType is required" });
        }

        const content = await storage.getContent(id);
        if (!content) {
          return res.status(404).json({ error: "Content not found" });
        }

        const userId = getUserId(req);
        if (content.courseId) {
          if (!userId) return res.status(403).json({ error: "Unauthorized" });
          const course = await storage.getCourse(content.courseId, userId);
          if (!course) return res.status(404).json({ error: "Content not found" });
        } else if (content.userId && content.userId !== userId) {
          return res.status(403).json({ error: "Unauthorized" });
        }

        let fixedContent = content.content;

        if (fixType === "convert-markdown-tables") {
          fixedContent = convertMarkdownTablesToHtml(content.content);
        } else if (fixType === "fix-heading-skip") {
          fixedContent = fixHeadingSkip(content.content);
        } else if (fixType === "fix-vague-link-text") {
          const rateLimitKey = userId ?? (req.ip || req.socket.remoteAddress || "unknown");
          const rateLimitFn = userId ? checkAiGenRateLimit : checkAnonRateLimit;
          if (!rateLimitFn(rateLimitKey)) {
            return res.status(429).json({ error: "Rate limit exceeded. Please try again later." });
          }
          fixedContent = await fixVagueLinkTextAI(content.content);
        } else if (fixType === "fix-all-caps") {
          fixedContent = fixAllCaps(content.content);
        } else if (fixType === "fix-html-table-caption") {
          fixedContent = fixHtmlTableCaption(content.content, captionTexts ?? captionText);
        } else if (fixType === "edit-html-table-caption") {
          fixedContent = editHtmlTableCaption(content.content, captionText ?? "Table summary", captionIndex !== undefined ? Number(captionIndex) : undefined);
        } else if (fixType === "fix-html-table-thead") {
          fixedContent = fixHtmlTableThead(content.content);
        } else {
          return res.status(400).json({ error: "Unknown fix type" });
        }

        if (fixedContent === content.content) {
          return res.json({ ...content, preFixVersionId: null });
        }

        const savedVersion = await storage.createVersion({
          generatedContentId: id,
          content: content.content,
          refinementRequest: "accessibility-fix-snapshot",
        });
        await storage.pruneOldVersions(id, VERSION_HISTORY_LIMIT);

        const updated = await storage.updateContent(id, fixedContent);
        res.json({ ...updated, preFixVersionId: savedVersion.id });
      } catch (error) {
        console.error("Error fixing accessibility issue:", error);
        res.status(500).json({ error: "Failed to apply fix" });
      }
    },
  );

  // List all saved versions for a content item
  app.get(
    "/api/content/:id/versions",
    optionalAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id as string);
        const content = await storage.getContent(id);
        if (!content) {
          return res.status(404).json({ error: "Content not found" });
        }

        const userId = getUserId(req);
        if (content.courseId) {
          if (!userId) return res.status(403).json({ error: "Unauthorized" });
          const course = await storage.getCourse(content.courseId, userId);
          if (!course) return res.status(404).json({ error: "Content not found" });
        } else if (content.userId && content.userId !== userId) {
          return res.status(403).json({ error: "Unauthorized" });
        }

        const versions = await storage.getVersionsByContent(id);
        res.json(versions);
      } catch (error) {
        console.error("Error fetching versions:", error);
        res.status(500).json({ error: "Failed to fetch versions" });
      }
    },
  );

  // Restore content to a previous version (used for undo accessibility fix)
  app.post(
    "/api/content/:id/restore-version",
    optionalAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id as string);
        const { versionId } = req.body;
        if (!versionId) {
          return res.status(400).json({ error: "versionId is required" });
        }

        const content = await storage.getContent(id);
        if (!content) {
          return res.status(404).json({ error: "Content not found" });
        }

        const userId = getUserId(req);
        if (content.courseId) {
          if (!userId) return res.status(403).json({ error: "Unauthorized" });
          const course = await storage.getCourse(content.courseId, userId);
          if (!course) return res.status(404).json({ error: "Content not found" });
        } else if (content.userId && content.userId !== userId) {
          return res.status(403).json({ error: "Unauthorized" });
        }

        const version = await storage.getVersionById(versionId);
        if (!version || version.generatedContentId !== id) {
          return res.status(404).json({ error: "Version not found" });
        }

        const restored = await storage.updateContent(id, version.content);
        res.json(restored);
      } catch (error) {
        console.error("Error restoring version:", error);
        res.status(500).json({ error: "Failed to restore version" });
      }
    },
  );

  // File upload for syllabus
  app.post(
    "/api/upload-syllabus",
    (req: Request, res: Response, next: NextFunction) => {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkAnonRateLimit(ip)) {
        return res.status(429).json({ error: "Rate limit exceeded. Please try again later." });
      }
      next();
    },
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const file = req.file;
        if (!file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        let content = "";
        const mimeType = file.mimetype;
        const fileName = file.originalname.toLowerCase();

        if (mimeType === "text/plain" || fileName.endsWith(".txt")) {
          content = file.buffer.toString("utf-8");
        } else if (
          mimeType === "application/pdf" ||
          fileName.endsWith(".pdf")
        ) {
          // For PDFs, we'll extract text using a simple approach
          // In production, you might want to use a library like pdf-parse
          content = `[PDF content from ${file.originalname}] - For full extraction, please paste the text content directly.`;
        } else if (
          fileName.endsWith(".doc") ||
          fileName.endsWith(".docx") ||
          mimeType.includes("word")
        ) {
          content = `[Word document content from ${file.originalname}] - For full extraction, please paste the text content directly.`;
        } else {
          return res.status(400).json({
            error:
              "Unsupported file type. Please upload a PDF, Word document, or text file.",
          });
        }

        res.json({ content, fileName: file.originalname });
      } catch (error) {
        console.error("Error uploading file:", error);
        res.status(500).json({ error: "Failed to process file" });
      }
    },
  );

  // Course duplication
  app.post(
    "/api/courses/:id/duplicate",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const id = parseInt(req.params.id as string);
        const duplicated = await storage.duplicateCourse(id, userId);
        if (!duplicated) {
          return res.status(404).json({ error: "Course not found" });
        }
        res.status(201).json(duplicated);
      } catch (error) {
        console.error("Error duplicating course:", error);
        res.status(500).json({ error: "Failed to duplicate course" });
      }
    },
  );

  // Saved Content Library API (protected, user-scoped)
  app.get(
    "/api/library",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const savedContent = await storage.getAllSavedContent(userId);
        res.json(savedContent);
      } catch (error) {
        console.error("Error fetching library:", error);
        res.status(500).json({ error: "Failed to fetch library" });
      }
    },
  );

  app.post(
    "/api/library",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const { title, toolType, content, description } = req.body;
        const saved = await storage.createSavedContent({
          title,
          toolType,
          content,
          description,
        }, userId);
        res.status(201).json(saved);
      } catch (error) {
        console.error("Error saving to library:", error);
        res.status(500).json({ error: "Failed to save to library" });
      }
    },
  );

  app.delete(
    "/api/library/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const id = parseInt(req.params.id as string);
        await storage.deleteSavedContent(id, userId);
        res.status(204).send();
      } catch (error) {
        console.error("Error deleting from library:", error);
        res.status(500).json({ error: "Failed to delete from library" });
      }
    },
  );

  // Word Document Export
  app.get(
    "/api/content/:id/export-docx",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const id = parseInt(req.params.id as string);
        const content = await storage.getContent(id);

        if (!content) {
          return res.status(404).json({ error: "Content not found" });
        }

        let course: any = null;
        if (content.courseId) {
          course = await storage.getCourse(content.courseId, userId);
          if (!course) {
            return res.status(404).json({ error: "Content not found" });
          }
        } else if (content.userId !== userId) {
          return res.status(404).json({ error: "Content not found" });
        }

        const children: Paragraph[] = [];

        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: content.toolName,
                bold: true,
                size: 36,
                color: "7C1D32",
              }),
            ],
            heading: HeadingLevel.TITLE,
            spacing: { after: 200 },
          }),
        );

        if (course) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `${course.courseName} (${course.courseNumber}${course.sectionNumber ? `, Section ${course.sectionNumber}` : ""})`,
                  size: 24,
                  color: "666666",
                }),
              ],
              spacing: { after: 100 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `Instructor: ${course.instructor} | Semester: ${course.semester}`,
                  size: 20,
                  color: "666666",
                }),
              ],
              spacing: { after: 400 },
            }),
          );
        }

        children.push(
          new Paragraph({
            children: [],
            border: {
              bottom: { color: "CCCCCC", style: BorderStyle.SINGLE, size: 6 },
            },
            spacing: { after: 400 },
          }),
        );

        const lines = content.content.split("\n");

        for (const line of lines) {
          if (!line.trim()) {
            children.push(new Paragraph({ children: [] }));
            continue;
          }

          if (line.startsWith("# ")) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: line.replace(/^# /, ""),
                    bold: true,
                    size: 32,
                    color: "7C1D32",
                  }),
                ],
                heading: HeadingLevel.HEADING_1,
                spacing: { before: 400, after: 200 },
              }),
            );
          } else if (line.startsWith("## ")) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: line.replace(/^## /, ""),
                    bold: true,
                    size: 28,
                    color: "333333",
                  }),
                ],
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 300, after: 150 },
              }),
            );
          } else if (line.startsWith("### ")) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: line.replace(/^### /, ""),
                    bold: true,
                    size: 24,
                  }),
                ],
                heading: HeadingLevel.HEADING_3,
                spacing: { before: 200, after: 100 },
              }),
            );
          } else if (line.match(/^[-*] /)) {
            const textContent = line.replace(/^[-*] /, "");
            const textRuns = parseInlineFormatting(textContent);
            children.push(
              new Paragraph({
                children: textRuns,
                bullet: { level: 0 },
                spacing: { after: 80 },
              }),
            );
          } else if (line.match(/^\d+\. /)) {
            const textContent = line.replace(/^\d+\. /, "");
            const textRuns = parseInlineFormatting(textContent);
            children.push(
              new Paragraph({
                children: textRuns,
                numbering: { reference: "numbering", level: 0 },
                spacing: { after: 80 },
              }),
            );
          } else if (line.startsWith("   - ") || line.startsWith("   * ")) {
            const textContent = line.replace(/^   [-*] /, "");
            const textRuns = parseInlineFormatting(textContent);
            children.push(
              new Paragraph({
                children: textRuns,
                bullet: { level: 1 },
                spacing: { after: 60 },
              }),
            );
          } else {
            const textRuns = parseInlineFormatting(line);
            children.push(
              new Paragraph({
                children: textRuns,
                spacing: { after: 120 },
              }),
            );
          }
        }

        children.push(
          new Paragraph({ children: [], spacing: { before: 600 } }),
          new Paragraph({
            children: [
              new TextRun({
                text: "Generated by BSU Instructional Design Tool",
                size: 18,
                color: "999999",
                italics: true,
              }),
            ],
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Created on ${new Date(content.createdAt).toLocaleDateString()}`,
                size: 18,
                color: "999999",
                italics: true,
              }),
            ],
            alignment: AlignmentType.CENTER,
          }),
        );

        const doc = new Document({
          numbering: {
            config: [
              {
                reference: "numbering",
                levels: [
                  {
                    level: 0,
                    format: "decimal",
                    text: "%1.",
                    alignment: AlignmentType.START,
                  },
                ],
              },
            ],
          },
          sections: [
            {
              properties: {
                page: {
                  margin: {
                    top: 1440,
                    right: 1440,
                    bottom: 1440,
                    left: 1440,
                  },
                },
              },
              children,
            },
          ],
        });

        const buffer = await Packer.toBuffer(doc);

        const filename = sanitizeHeaderFilename(`${content.toolName.replace(/\s+/g, "_")}_${course?.courseNumber || "export"}.docx`);

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.send(buffer);
      } catch (error) {
        console.error("Error exporting to Word:", error);
        res.status(500).json({ error: "Failed to export to Word" });
      }
    },
  );

  // =============================================
  // DOCUMENT ACCESSIBILITY CONVERSION ROUTES
  // =============================================

  const ACCEPTED_MIMES = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]);

  const docUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (ACCEPTED_MIMES.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Only PDF and Word (.docx) files are allowed"));
      }
    },
  });

  function getVisitorToken(req: Request): string | null {
    return (req.session as any).visitorToken ?? null;
  }

  function ensureVisitorToken(req: Request): string {
    const session = req.session as any;
    if (!session.visitorToken) {
      session.visitorToken = randomUUID();
    }
    return session.visitorToken;
  }

  function conversionOwnerFilter(id: number, userId: string | null, visitorToken?: string | null) {
    if (userId) {
      return and(eq(conversions.id, id), eq(conversions.userId, userId));
    }
    if (visitorToken) {
      return and(eq(conversions.id, id), isNull(conversions.userId), eq(conversions.visitorToken, visitorToken));
    }
    // No identity available — return a condition that never matches to deny access
    return sql<boolean>`FALSE`;
  }

  app.get(
    "/api/conversions",
    isAuthenticated,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const results = await db
        .select({
          id: conversions.id,
          originalFilename: conversions.originalFilename,
          fileSize: conversions.fileSize,
          sourceType: conversions.sourceType,
          status: conversions.status,
          pageCount: conversions.pageCount,
          ocrApplied: conversions.ocrApplied,
          complianceReport: conversions.complianceReport,
          createdAt: conversions.createdAt,
          updatedAt: conversions.updatedAt,
        })
        .from(conversions)
        .where(userId ? eq(conversions.userId, userId) : isNull(conversions.userId))
        .orderBy(desc(conversions.createdAt));
      res.json(results);
    },
  );

  app.get(
    "/api/conversions/:id",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid ID" });
        return;
      }

      const [conversion] = await db
        .select({
          id: conversions.id,
          originalFilename: conversions.originalFilename,
          fileSize: conversions.fileSize,
          sourceType: conversions.sourceType,
          status: conversions.status,
          pageCount: conversions.pageCount,
          extractedText: conversions.extractedText,
          accessibleHtml: conversions.accessibleHtml,
          complianceReport: conversions.complianceReport,
          originalComplianceReport: conversions.originalComplianceReport,
          statusMessage: conversions.statusMessage,
          errorMessage: conversions.errorMessage,
          ocrApplied: conversions.ocrApplied,
          createdAt: conversions.createdAt,
          updatedAt: conversions.updatedAt,
        })
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: "Conversion not found" });
        return;
      }
      res.json(conversion);
    },
  );

  const uploadRateLimitGuard = (req: Request, res: Response, next: NextFunction) => {
    const userId = getUserId(req);
    const key = userId ?? (req.ip || req.socket.remoteAddress || "unknown");
    const fn = userId ? checkUploadRateLimit : checkAnonRateLimit;
    if (!fn(key)) {
      res.status(429).json({ error: "Upload rate limit exceeded. Please try again later." });
      return;
    }
    next();
  };

  app.post(
    "/api/conversions/upload",
    optionalAuth,
    uploadRateLimitGuard,
    docUpload.single("file"),
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const visitorToken = userId ? null : ensureVisitorToken(req);

      const fileBase64 = file.buffer.toString("base64");
      const explicitSourceType = req.body?.sourceType;
      const sourceType =
        explicitSourceType === "google-doc"
          ? "google-doc"
          : file.mimetype ===
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ? "docx"
            : "pdf";

      const [created] = await db
        .insert(conversions)
        .values({
          originalFilename: file.originalname,
          fileSize: file.size,
          sourceType,
          status: "uploaded",
          pdfData: fileBase64,
          userId: userId || null,
          visitorToken,
        })
        .returning({
          id: conversions.id,
          originalFilename: conversions.originalFilename,
          fileSize: conversions.fileSize,
          sourceType: conversions.sourceType,
          status: conversions.status,
          createdAt: conversions.createdAt,
        });

      res.json(created);
    },
  );

  app.post(
    "/api/conversions/import-google-doc",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);

      const googleDocRateLimitKey = userId ?? (req.ip || req.socket.remoteAddress || "unknown");
      const googleDocRateLimitFn = userId ? checkUploadRateLimit : checkAnonRateLimit;
      if (!googleDocRateLimitFn(googleDocRateLimitKey)) {
        return res.status(429).json({ error: "Upload rate limit exceeded. Please try again later." });
      }

      const googleDocVisitorToken = userId ? null : ensureVisitorToken(req);

      const { url } = req.body;
      if (!url || typeof url !== "string") {
        return res
          .status(400)
          .json({ error: "A Google Docs URL is required." });
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return res
          .status(400)
          .json({
            error: "Invalid URL format. Please paste a Google Docs link.",
          });
      }
      if (
        parsedUrl.hostname !== "docs.google.com" ||
        !parsedUrl.pathname.startsWith("/document/d/")
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid Google Docs URL. Please paste a link like https://docs.google.com/document/d/...",
          });
      }
      const docIdMatch = parsedUrl.pathname.match(
        /\/document\/d\/([a-zA-Z0-9_-]+)/,
      );
      if (!docIdMatch) {
        return res
          .status(400)
          .json({ error: "Could not extract document ID from URL." });
      }
      const docId = docIdMatch[1];

      try {
        const exportUrls = [
          `https://docs.google.com/document/d/${docId}/export?format=docx`,
          `https://drive.google.com/uc?export=download&id=${docId}`,
        ];

        let response: globalThis.Response | null = null;
        let lastStatus = 0;
        let buffer: Buffer | null = null;

        const MAX_IMPORT_SIZE = 20 * 1024 * 1024;

        for (const exportUrl of exportUrls) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 30000);

          try {
            const attempt = await fetch(exportUrl, {
              signal: controller.signal,
              redirect: "follow",
              headers: { "User-Agent": "Mozilla/5.0" },
            });
            lastStatus = attempt.status;
            if (attempt.ok) {
              // Reject early if content-length header already exceeds limit.
              const contentLength = attempt.headers.get("content-length");
              if (contentLength && parseInt(contentLength, 10) > MAX_IMPORT_SIZE) {
                clearTimeout(timeout);
                return res
                  .status(413)
                  .json({ error: "Document is too large (max 20 MB)." });
              }

              // Stream the body while the AbortController timeout is still
              // active, so a slow or infinite body cannot stall the server
              // indefinitely. Size is enforced incrementally on each chunk.
              const chunks: Buffer[] = [];
              let totalSize = 0;
              const reader = attempt.body!.getReader();
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  totalSize += value.length;
                  if (totalSize > MAX_IMPORT_SIZE) {
                    reader.cancel();
                    clearTimeout(timeout);
                    return res
                      .status(413)
                      .json({ error: "Document is too large (max 20 MB)." });
                  }
                  chunks.push(Buffer.from(value));
                }
              } finally {
                reader.releaseLock();
              }

              response = attempt;
              buffer = Buffer.concat(chunks);
              break;
            }
          } catch (fetchErr: any) {
            if (fetchErr.name === "AbortError") {
              return res
                .status(504)
                .json({
                  error:
                    "Download timed out. The document may be too large or Google is not responding.",
                });
            }
          } finally {
            clearTimeout(timeout);
          }
        }

        if (!response || !buffer) {
          if (lastStatus === 403 || lastStatus === 401) {
            return res
              .status(403)
              .json({
                error:
                  'This document is not publicly shared. Set sharing to "Anyone with the link" in Google Docs, then try again.',
              });
          }
          if (lastStatus === 404) {
            return res
              .status(404)
              .json({
                error: "Document not found. Check that the URL is correct.",
              });
          }
          return res
            .status(502)
            .json({
              error: `Could not download the document (status ${lastStatus}). The document may not be publicly shared.`,
            });
        }
        if (buffer.length < 100) {
          return res
            .status(502)
            .json({
              error:
                "Downloaded file appears empty. The document may not be publicly shared.",
            });
        }

        const zipSignature = buffer.slice(0, 4).toString("hex");
        if (zipSignature !== "504b0304") {
          return res
            .status(502)
            .json({
              error:
                "The downloaded file is not a valid document. The Google Doc may not be publicly shared.",
            });
        }

        const titleHeader = response.headers.get("content-disposition");
        let filename = "Google Doc.docx";
        if (titleHeader) {
          const filenameMatch = titleHeader.match(
            /filename\*?=(?:UTF-8''|"?)([^";]+)/i,
          );
          if (filenameMatch) {
            filename = decodeURIComponent(filenameMatch[1].replace(/"/g, ""));
            if (!filename.endsWith(".docx")) filename += ".docx";
          }
        }

        const fileBase64 = buffer.toString("base64");
        const [created] = await db
          .insert(conversions)
          .values({
            originalFilename: filename,
            fileSize: buffer.length,
            sourceType: "google-doc",
            status: "uploaded",
            pdfData: fileBase64,
            userId: userId || null,
            visitorToken: googleDocVisitorToken,
          })
          .returning({
            id: conversions.id,
            originalFilename: conversions.originalFilename,
            fileSize: conversions.fileSize,
            sourceType: conversions.sourceType,
            status: conversions.status,
            createdAt: conversions.createdAt,
          });

        res.json(created);
      } catch (err: any) {
        if (err.name === "AbortError") {
          return res
            .status(504)
            .json({
              error:
                "Download timed out. The document may be too large or Google is not responding.",
            });
        }
        console.error("Google Doc import error:", err);
        res
          .status(500)
          .json({
            error:
              "Failed to import the Google Doc. Please check the URL and try again.",
          });
      }
    },
  );

  app.post(
    "/api/conversions/import-google-sheet",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);

      const sheetRateLimitKey = userId ?? (req.ip || req.socket.remoteAddress || "unknown");
      const sheetRateLimitFn = userId ? checkUploadRateLimit : checkAnonRateLimit;
      if (!sheetRateLimitFn(sheetRateLimitKey)) {
        return res.status(429).json({ error: "Upload rate limit exceeded. Please try again later." });
      }

      const { url } = req.body;
      if (!url || typeof url !== "string") {
        return res
          .status(400)
          .json({ error: "A Google Sheets URL is required." });
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return res
          .status(400)
          .json({
            error: "Invalid URL format. Please paste a Google Sheets link.",
          });
      }
      if (
        parsedUrl.hostname !== "docs.google.com" ||
        !parsedUrl.pathname.startsWith("/spreadsheets/d/")
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid Google Sheets URL. Please paste a link like https://docs.google.com/spreadsheets/d/...",
          });
      }
      const sheetIdMatch = parsedUrl.pathname.match(
        /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
      );
      if (!sheetIdMatch) {
        return res
          .status(400)
          .json({ error: "Could not extract spreadsheet ID from URL." });
      }
      const sheetId = sheetIdMatch[1];

      try {
        const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        let response: globalThis.Response | null = null;
        let lastStatus = 0;
        let buffer: Buffer | null = null;

        const MAX_IMPORT_SIZE = 20 * 1024 * 1024;

        try {
          const attempt = await fetch(exportUrl, {
            signal: controller.signal,
            redirect: "follow",
            headers: { "User-Agent": "Mozilla/5.0" },
          });
          lastStatus = attempt.status;
          if (attempt.ok) {
            // Reject early if content-length header already exceeds limit.
            const contentLength = attempt.headers.get("content-length");
            if (contentLength && parseInt(contentLength, 10) > MAX_IMPORT_SIZE) {
              clearTimeout(timeout);
              return res
                .status(413)
                .json({ error: "Spreadsheet is too large (max 20 MB)." });
            }

            // Stream the body while the AbortController timeout is still
            // active, so a slow or infinite body cannot stall the server
            // indefinitely. Size is enforced incrementally on each chunk.
            const chunks: Buffer[] = [];
            let totalSize = 0;
            const reader = attempt.body!.getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                totalSize += value.length;
                if (totalSize > MAX_IMPORT_SIZE) {
                  reader.cancel();
                  clearTimeout(timeout);
                  return res
                    .status(413)
                    .json({ error: "Spreadsheet is too large (max 20 MB)." });
                }
                chunks.push(Buffer.from(value));
              }
            } finally {
              reader.releaseLock();
            }

            response = attempt;
            buffer = Buffer.concat(chunks);
          }
        } catch (fetchErr: any) {
          if (fetchErr.name === "AbortError") {
            return res
              .status(504)
              .json({
                error:
                  "Download timed out. The spreadsheet may be too large or Google is not responding.",
              });
          }
        } finally {
          clearTimeout(timeout);
        }

        if (!response || !buffer) {
          if (lastStatus === 403 || lastStatus === 401) {
            return res
              .status(403)
              .json({
                error:
                  'This spreadsheet is not publicly shared. Set sharing to "Anyone with the link" in Google Sheets, then try again.',
              });
          }
          if (lastStatus === 404) {
            return res
              .status(404)
              .json({
                error: "Spreadsheet not found. Check that the URL is correct.",
              });
          }
          return res
            .status(502)
            .json({
              error: `Could not download the spreadsheet (status ${lastStatus}). The spreadsheet may not be publicly shared.`,
            });
        }
        if (buffer.length < 100) {
          return res
            .status(502)
            .json({
              error:
                "Downloaded file appears empty. The spreadsheet may not be publicly shared.",
            });
        }

        const zipSignature = buffer.slice(0, 4).toString("hex");
        if (zipSignature !== "504b0304") {
          return res
            .status(502)
            .json({
              error:
                "The downloaded file is not a valid spreadsheet. The Google Sheet may not be publicly shared.",
            });
        }

        const titleHeader = response.headers.get("content-disposition");
        let filename = "Google Sheet.xlsx";
        if (titleHeader) {
          const filenameMatch = titleHeader.match(
            /filename\*?=(?:UTF-8''|"?)([^";]+)/i,
          );
          if (filenameMatch) {
            filename = decodeURIComponent(filenameMatch[1].replace(/"/g, ""));
            if (!filename.endsWith(".xlsx")) filename += ".xlsx";
          }
        }

        const googleSheetVisitorToken = userId ? null : ensureVisitorToken(req);
        const fileBase64 = buffer.toString("base64");
        const [created] = await db
          .insert(conversions)
          .values({
            originalFilename: filename,
            fileSize: buffer.length,
            sourceType: "google-sheet",
            status: "uploaded",
            pdfData: fileBase64,
            userId: userId || null,
            visitorToken: googleSheetVisitorToken,
          })
          .returning({
            id: conversions.id,
            originalFilename: conversions.originalFilename,
            fileSize: conversions.fileSize,
            sourceType: conversions.sourceType,
            status: conversions.status,
            createdAt: conversions.createdAt,
          });

        res.json(created);
      } catch (err: any) {
        if (err.name === "AbortError") {
          return res
            .status(504)
            .json({
              error:
                "Download timed out. The spreadsheet may be too large or Google is not responding.",
            });
        }
        console.error("Google Sheet import error:", err);
        res
          .status(500)
          .json({
            error:
              "Failed to import the Google Sheet. Please check the URL and try again.",
          });
      }
    },
  );

  app.post(
    "/api/conversions/:id/process",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid ID" });
        return;
      }

      const [conversion] = await db
        .select()
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: "Conversion not found" });
        return;
      }
      if (conversion.status === "processing") {
        res.status(400).json({ error: "Already processing" });
        return;
      }

      // Rate-limit heavy processing (per-user or per-IP)
      const rateLimitKey = userId ? `user:${userId}` : `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
      if (!checkHeavyOpRateLimit(`process:${rateLimitKey}`)) {
        res.status(429).json({ error: "Too many processing requests. Please wait before submitting another document." });
        return;
      }

      // Global concurrency cap to prevent CPU/memory exhaustion.
      // Increment the slot counter synchronously before any await so that
      // concurrent requests that pass the >= check cannot all race through
      // before any of them increments.
      if (activeProcessingJobs >= MAX_CONCURRENT_PROCESSING) {
        res.status(503).json({ error: "Server is busy processing other documents. Please try again shortly." });
        return;
      }
      activeProcessingJobs++;

      try {
        await db
          .update(conversions)
          .set({
            status: "processing",
            statusMessage: "Starting conversion…",
            updatedAt: new Date(),
          })
          .where(eq(conversions.id, id));
      } catch (err) {
        activeProcessingJobs--;
        throw err;
      }

      const { pdfData: _pdfData, ...safeConversion } = conversion;
      res.json({
        ...safeConversion,
        status: "processing",
        statusMessage: "Starting conversion…",
      });

      const updateStatusMessage = async (message: string) => {
        try {
          await db
            .update(conversions)
            .set({ statusMessage: message, updatedAt: new Date() })
            .where(eq(conversions.id, id));
        } catch (e) {
          console.error("Failed to update status message:", e);
        }
      };

      (async () => {
        const conversionStart = Date.now();
        const TIMEOUT_MS = 10 * 60 * 1000;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        // aborted is set to true when the timeout fires so that the inner
        // pipeline can bail out early and the completed-status write is
        // suppressed, preventing a timed-out job from overwriting the
        // failed status that the timeout handler already persisted.
        let aborted = false;

        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            aborted = true;
            reject(new Error("Conversion timed out after 10 minutes. The document may be too large or complex. Please try a smaller file."));
          }, TIMEOUT_MS);
        });

        const innerWorkPromise = (async () => {
          const { generateAccessibleDocument, evaluateOriginalDocument } =
            await import("./lib/accessibility-engine");
          const fileBuffer = Buffer.from(conversion.pdfData!, "base64");
          const srcType = conversion.sourceType || "pdf";

          let extraction: import("./lib/pdf-processor").PdfExtraction;
          let ocrApplied = false;

          if (srcType === "google-sheet") {
            await updateStatusMessage("Extracting Google Sheet content…");
            const { extractXlsxContent } = await import("./lib/xlsx-extractor");
            extraction = await extractXlsxContent(fileBuffer);
          } else if (srcType === "docx" || srcType === "google-doc") {
            await updateStatusMessage(
              srcType === "google-doc"
                ? "Extracting Google Doc content…"
                : "Extracting Word document content…",
            );
            const { extractDocxContent } = await import("./lib/docx-extractor");
            extraction = await extractDocxContent(fileBuffer);
          } else {
            await updateStatusMessage("Extracting PDF content…");
            const { extractPdfContent, needsOcr } = await import(
              "./lib/pdf-processor"
            );
            extraction = await extractPdfContent(fileBuffer);
            ocrApplied = needsOcr(extraction.text, extraction.pageCount);
          }

          // Bail out early if the timeout already fired during extraction.
          if (aborted) throw new Error("aborted");

          let finalText = extraction.text;
          if (ocrApplied && extraction.images.length > 0) {
            await updateStatusMessage("Running OCR on scanned pages…");
            const ocrTexts: string[] = [];
            for (const img of extraction.images.slice(0, 5)) {
              // Stop OCR iteration if a timeout occurred mid-loop.
              if (aborted) break;
              try {
                const ocrResponse = await anthropic.messages.create({
                  model: "claude-sonnet-4-5",
                  max_tokens: 2048,
                  messages: [
                    {
                      role: "user",
                      content: [
                        {
                          type: "image",
                          source: {
                            type: "base64",
                            media_type: "image/png",
                            data: img.dataUrl.split(",")[1] || "",
                          },
                        },
                        {
                          type: "text",
                          text: "Extract all text from this scanned document page. Maintain the reading order and structure. Output only the extracted text.",
                        },
                      ],
                    },
                  ],
                });
                const ocrText =
                  ocrResponse.content[0]?.type === "text"
                    ? ocrResponse.content[0].text
                    : "";
                if (ocrText) ocrTexts.push(ocrText);
              } catch {}
            }
            if (ocrTexts.length > 0) {
              finalText = ocrTexts.join("\n\n---\n\n");
            }
          }

          // Bail out before the most expensive AI step if already timed out.
          if (aborted) throw new Error("aborted");

          await updateStatusMessage("Evaluating original document…");
          const originalReport = evaluateOriginalDocument(finalText);

          const result = await generateAccessibleDocument(
            finalText,
            conversion.originalFilename,
            extraction.metadata,
            extraction.images,
            extraction.tables,
            extraction.pageCount,
            updateStatusMessage,
          );

          // Guard the success write: if the timeout fired while
          // generateAccessibleDocument was running, the DB row was already
          // marked failed; writing completed here would corrupt that state.
          if (aborted) throw new Error("aborted");

          await db
            .update(conversions)
            .set({
              status: "completed",
              statusMessage: null,
              pageCount: extraction.pageCount,
              extractedText: finalText.substring(0, 50000),
              accessibleHtml: result.accessibleHtml,
              complianceReport: result.complianceReport,
              originalComplianceReport: originalReport,
              ocrApplied,
              pdfData: null,
              updatedAt: new Date(),
            })
            .where(eq(conversions.id, id));

          const elapsed = Math.round((Date.now() - conversionStart) / 1000);
          console.log(`[conversion #${id}] completed in ${elapsed}s (${conversion.originalFilename})`);
        })();

        try {
          await Promise.race([innerWorkPromise, timeoutPromise]);
        } catch (err: any) {
          const elapsed = Math.round((Date.now() - conversionStart) / 1000);
          console.error(`[conversion #${id}] failed after ${elapsed}s: ${err.message}`);
          await db
            .update(conversions)
            .set({
              status: "failed",
              statusMessage: null,
              errorMessage: err.message || "Processing failed",
              updatedAt: new Date(),
            })
            .where(eq(conversions.id, id));
        } finally {
          clearTimeout(timeoutId);
          // Release the concurrency slot immediately, even when the timeout
          // fired and the inner pipeline is still winding down.  Holding the
          // slot open until the background work settles would let a few
          // slow or adversarial documents monopolise all processing slots
          // well beyond the advertised 10-minute timeout, blocking everyone
          // else.  The inner work is allowed to finish (or error) on its own;
          // it already guards all DB writes behind the `aborted` flag so
          // settling after slot release is safe.
          if (aborted) {
            innerWorkPromise.catch(() => {});
          }
          activeProcessingJobs--;
        }
      })();
    },
  );

  app.delete(
    "/api/conversions/:id",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid ID" });
        return;
      }

      await db.delete(conversions).where(conversionOwnerFilter(id, userId, getVisitorToken(req)));
      res.json({ success: true });
    },
  );

  app.post(
    "/api/conversions/:id/fix-issue",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid ID" });
        return;
      }

      const { issueIndex } = req.body;
      if (typeof issueIndex !== "number") {
        res.status(400).json({ error: "issueIndex required" });
        return;
      }

      const [conversion] = await db
        .select()
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: "Conversion not found" });
        return;
      }
      if (conversion.status !== "completed" || !conversion.accessibleHtml) {
        res.status(400).json({ error: "Conversion must be completed" });
        return;
      }

      // Rate-limit AI fix calls (per-user or per-IP)
      const fixRateLimitKey = userId ? `user:${userId}` : `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
      if (!checkHeavyOpRateLimit(`fix:${fixRateLimitKey}`)) {
        res.status(429).json({ error: "Too many fix requests. Please wait before trying again." });
        return;
      }

      // Global concurrency cap to prevent exhausting AI quota and server resources
      if (activeFixJobs >= MAX_CONCURRENT_FIXES) {
        res.status(503).json({ error: "Server is busy processing fixes. Please try again shortly." });
        return;
      }

      const report = conversion.complianceReport as any;
      if (!report?.issues?.[issueIndex]) {
        res.status(400).json({ error: "Issue not found" });
        return;
      }

      // Per-conversion/issue in-flight deduplication — reject duplicate concurrent fix requests
      const fixDedupeKey = `${id}:${issueIndex}`;
      if (activeFixKeys.has(fixDedupeKey)) {
        res.status(409).json({ error: "A fix for this issue is already in progress. Please wait." });
        return;
      }

      activeFixJobs++;
      activeFixKeys.add(fixDedupeKey);
      try {
        const { fixComplianceIssue } = await import(
          "./lib/accessibility-engine"
        );
        const result = await fixComplianceIssue(
          conversion.accessibleHtml,
          report.issues[issueIndex],
          issueIndex,
          report,
        );

        const [updated] = await db
          .update(conversions)
          .set({
            accessibleHtml: result.accessibleHtml,
            complianceReport: result.complianceReport,
            updatedAt: new Date(),
          })
          .where(eq(conversions.id, id))
          .returning({
            id: conversions.id,
            originalFilename: conversions.originalFilename,
            fileSize: conversions.fileSize,
            status: conversions.status,
            pageCount: conversions.pageCount,
            extractedText: conversions.extractedText,
            accessibleHtml: conversions.accessibleHtml,
            complianceReport: conversions.complianceReport,
            originalComplianceReport: conversions.originalComplianceReport,
            errorMessage: conversions.errorMessage,
            ocrApplied: conversions.ocrApplied,
            createdAt: conversions.createdAt,
            updatedAt: conversions.updatedAt,
          });

        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ error: err.message || "Fix failed" });
      } finally {
        activeFixJobs--;
        activeFixKeys.delete(fixDedupeKey);
      }
    },
  );

  app.post(
    "/api/conversions/:id/accept-issue",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid ID" });
        return;
      }

      const { issueIndex, justification } = req.body;
      if (typeof issueIndex !== "number") {
        res.status(400).json({ error: "issueIndex required" });
        return;
      }

      const [conversion] = await db
        .select()
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: "Conversion not found" });
        return;
      }

      const report = conversion.complianceReport as any;
      if (!report?.issues?.[issueIndex]) {
        res.status(400).json({ error: "Issue not found" });
        return;
      }

      const issue = report.issues[issueIndex];
      report.issues[issueIndex] = {
        ...issue,
        previousStatus: issue.status,
        status: "accepted",
        justification: justification || "Accepted by user",
      };

      const { buildComplianceReport } = await import(
        "./lib/accessibility-engine"
      );
      const updatedReport = buildComplianceReport(report.issues);

      const [updated] = await db
        .update(conversions)
        .set({ complianceReport: updatedReport, updatedAt: new Date() })
        .where(eq(conversions.id, id))
        .returning({
          id: conversions.id,
          originalFilename: conversions.originalFilename,
          fileSize: conversions.fileSize,
          status: conversions.status,
          pageCount: conversions.pageCount,
          extractedText: conversions.extractedText,
          accessibleHtml: conversions.accessibleHtml,
          complianceReport: conversions.complianceReport,
          originalComplianceReport: conversions.originalComplianceReport,
          errorMessage: conversions.errorMessage,
          ocrApplied: conversions.ocrApplied,
          createdAt: conversions.createdAt,
          updatedAt: conversions.updatedAt,
        });

      res.json(updated);
    },
  );

  app.post(
    "/api/conversions/:id/revert-issue",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid ID" });
        return;
      }

      const { issueIndex } = req.body;
      if (typeof issueIndex !== "number") {
        res.status(400).json({ error: "issueIndex required" });
        return;
      }

      const [conversion] = await db
        .select()
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: "Conversion not found" });
        return;
      }

      const report = conversion.complianceReport as any;
      if (!report?.issues?.[issueIndex]) {
        res.status(400).json({ error: "Issue not found" });
        return;
      }

      const issue = report.issues[issueIndex];
      if (issue.status !== "accepted" || !issue.previousStatus) {
        res.status(400).json({ error: "Issue is not accepted" });
        return;
      }

      report.issues[issueIndex] = {
        ...issue,
        status: issue.previousStatus,
        previousStatus: undefined,
        justification: undefined,
      };

      const { buildComplianceReport } = await import(
        "./lib/accessibility-engine"
      );
      const updatedReport = buildComplianceReport(report.issues);

      const [updated] = await db
        .update(conversions)
        .set({ complianceReport: updatedReport, updatedAt: new Date() })
        .where(eq(conversions.id, id))
        .returning({
          id: conversions.id,
          originalFilename: conversions.originalFilename,
          fileSize: conversions.fileSize,
          status: conversions.status,
          pageCount: conversions.pageCount,
          extractedText: conversions.extractedText,
          accessibleHtml: conversions.accessibleHtml,
          complianceReport: conversions.complianceReport,
          originalComplianceReport: conversions.originalComplianceReport,
          errorMessage: conversions.errorMessage,
          ocrApplied: conversions.ocrApplied,
          createdAt: conversions.createdAt,
          updatedAt: conversions.updatedAt,
        });

      res.json(updated);
    },
  );

  app.put(
    "/api/conversions/:id/html",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid ID" });
        return;
      }

      const { html } = req.body;
      if (typeof html !== "string") {
        res.status(400).json({ error: "html required" });
        return;
      }

      const [conversion] = await db
        .select({ id: conversions.id, status: conversions.status })
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: "Conversion not found" });
        return;
      }
      if (conversion.status !== "completed") {
        res.status(400).json({ error: "Must be completed" });
        return;
      }

      const [updated] = await db
        .update(conversions)
        .set({ accessibleHtml: html, updatedAt: new Date() })
        .where(eq(conversions.id, id))
        .returning({
          id: conversions.id,
          originalFilename: conversions.originalFilename,
          fileSize: conversions.fileSize,
          status: conversions.status,
          pageCount: conversions.pageCount,
          extractedText: conversions.extractedText,
          accessibleHtml: conversions.accessibleHtml,
          complianceReport: conversions.complianceReport,
          originalComplianceReport: conversions.originalComplianceReport,
          errorMessage: conversions.errorMessage,
          ocrApplied: conversions.ocrApplied,
          createdAt: conversions.createdAt,
          updatedAt: conversions.updatedAt,
        });

      res.json(updated);
    },
  );

  app.get(
    "/api/conversions/:id/download",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid ID" });
        return;
      }

      const [conversion] = await db
        .select({
          accessibleHtml: conversions.accessibleHtml,
          originalFilename: conversions.originalFilename,
          status: conversions.status,
          updatedAt: conversions.updatedAt,
        })
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: "Conversion not found" });
        return;
      }
      if (conversion.status !== "completed" || !conversion.accessibleHtml) {
        res.status(400).json({ error: "HTML not available" });
        return;
      }

      let html = conversion.accessibleHtml;
      const updatedDate = conversion.updatedAt
        ? new Date(conversion.updatedAt)
        : new Date();
      const readableDate = updatedDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      const metaTag = `<meta name="date" content="${updatedDate.toISOString()}">`;
      const headCloseIdx = html.indexOf("</head>");
      if (headCloseIdx !== -1) {
        html =
          html.slice(0, headCloseIdx) +
          `  ${metaTag}\n` +
          html.slice(headCloseIdx);
      }

      const timestampFooter = `\n<footer style="margin-top:2rem;padding:1rem 0;border-top:1px solid #e0e0e0;font-size:0.85rem;color:#666;text-align:center;" role="contentinfo" aria-label="Document timestamp">\n  <p>This accessible document was last updated on ${readableDate}</p>\n</footer>`;
      const bodyCloseIdx = html.lastIndexOf("</body>");
      if (bodyCloseIdx !== -1) {
        html =
          html.slice(0, bodyCloseIdx) +
          timestampFooter +
          "\n" +
          html.slice(bodyCloseIdx);
      }

      const filename = sanitizeHeaderFilename(
        conversion.originalFilename.replace(/\.pdf$/i, "") + "-accessible.html"
      );
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.send(html);
    },
  );

  app.get(
    "/api/conversions/:id/download-docx",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid ID" });
        return;
      }

      const [conversion] = await db
        .select({
          accessibleHtml: conversions.accessibleHtml,
          originalFilename: conversions.originalFilename,
          status: conversions.status,
          updatedAt: conversions.updatedAt,
        })
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: "Conversion not found" });
        return;
      }
      if (conversion.status !== "completed" || !conversion.accessibleHtml) {
        res.status(400).json({ error: "HTML not available" });
        return;
      }

      // Rate-limit DOCX export (per-user or per-IP)
      const docxRateLimitKey = userId ? `user:${userId}` : `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
      if (!checkHeavyOpRateLimit(`docx:${docxRateLimitKey}`)) {
        res.status(429).json({ error: "Too many DOCX export requests. Please wait before trying again." });
        return;
      }

      // Global concurrency cap to prevent CPU/memory exhaustion from parallel DOCX builds
      if (activeDocxExports >= MAX_CONCURRENT_DOCX_EXPORTS) {
        res.status(503).json({ error: "Server is busy generating DOCX files. Please try again shortly." });
        return;
      }
      activeDocxExports++;

      let html = conversion.accessibleHtml;
      const updatedDate = conversion.updatedAt
        ? new Date(conversion.updatedAt)
        : new Date();
      const readableDate = updatedDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      const timestampFooter = `\n<footer style="margin-top:2rem;padding:1rem 0;border-top:1px solid #e0e0e0;font-size:0.85rem;color:#666;text-align:center;" role="contentinfo" aria-label="Document timestamp">\n  <p>This accessible document was last updated on ${readableDate}</p>\n</footer>`;
      const bodyCloseIdx = html.lastIndexOf("</body>");
      if (bodyCloseIdx !== -1) {
        html =
          html.slice(0, bodyCloseIdx) +
          timestampFooter +
          "\n" +
          html.slice(bodyCloseIdx);
      }

      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      const docTitle = titleMatch
        ? titleMatch[1]
        : conversion.originalFilename.replace(/\.pdf$/i, "");
      const langMatch = html.match(/<html[^>]*\slang=["']([^"']+)["']/i);
      const docLang = langMatch ? langMatch[1] : "en";

      try {
        const { buildDocx } = await import("./lib/docx-builder");
        const docxBuffer = await buildDocx(html, {
          title: docTitle,
          filename: conversion.originalFilename,
          lang: docLang,
          author: "Accessibility Converter",
        });

        const filename = sanitizeHeaderFilename(
          conversion.originalFilename
            .replace(/\.pdf$/i, "")
            .replace(/[^\w\s.-]/g, "_") + "-accessible.docx"
        );
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.setHeader("Content-Length", docxBuffer.length);
        res.end(docxBuffer);
      } catch (err) {
        console.error("DOCX conversion error:", err);
        res.status(500).json({ error: "Failed to generate DOCX file" });
      } finally {
        activeDocxExports--;
      }
    },
  );

  app.get(
    "/api/conversions/:id/download-pdf",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid ID" });
        return;
      }

      const [conversion] = await db
        .select({
          accessibleHtml: conversions.accessibleHtml,
          originalFilename: conversions.originalFilename,
          status: conversions.status,
          updatedAt: conversions.updatedAt,
        })
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: "Conversion not found" });
        return;
      }
      if (conversion.status !== "completed" || !conversion.accessibleHtml) {
        res.status(400).json({ error: "Accessible HTML is not yet available" });
        return;
      }

      // Rate-limit PDF export (per-user or per-IP)
      const pdfRateLimitKey = userId ? `user:${userId}` : `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
      if (!checkHeavyOpRateLimit(`pdf:${pdfRateLimitKey}`)) {
        res.status(429).json({ error: "Too many PDF export requests. Please wait before trying again." });
        return;
      }

      // Global concurrency cap to prevent exhausting Chromium workers
      if (activePdfExports >= MAX_CONCURRENT_PDF_EXPORTS) {
        res.status(503).json({ error: "Server is busy generating PDFs. Please try again shortly." });
        return;
      }
      activePdfExports++;

      let html = conversion.accessibleHtml;
      const updatedDate = conversion.updatedAt
        ? new Date(conversion.updatedAt)
        : new Date();
      const isoDate = updatedDate.toISOString();
      const readableDate = updatedDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      const metaTag = `<meta name="date" content="${isoDate}">`;
      const headCloseIdx = html.indexOf("</head>");
      if (headCloseIdx !== -1) {
        html =
          html.slice(0, headCloseIdx) +
          `  ${metaTag}\n` +
          html.slice(headCloseIdx);
      }

      const timestampFooter = `\n<footer style="margin-top:2rem;padding:1rem 0;border-top:1px solid #e0e0e0;font-size:0.85rem;color:#666;text-align:center;" role="contentinfo" aria-label="Document timestamp">\n  <p>This accessible document was last updated on ${readableDate}</p>\n</footer>`;
      const bodyCloseIdx = html.lastIndexOf("</body>");
      if (bodyCloseIdx !== -1) {
        html =
          html.slice(0, bodyCloseIdx) +
          timestampFooter +
          "\n" +
          html.slice(bodyCloseIdx);
      }

      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      const docTitle = titleMatch
        ? titleMatch[1]
        : conversion.originalFilename.replace(/\.pdf$/i, "");
      const langMatch = html.match(/<html[^>]*\slang=["']([^"']+)["']/i);
      const docLang = langMatch ? langMatch[1] : "en";
      const authorMatch =
        html.match(/<meta\s+name=["']author["']\s+content=["']([^"']+)["']/i) ||
        html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']author["']/i);
      const docAuthor = authorMatch
        ? authorMatch[1]
        : "Accessibility Converter";

      try {
        const { buildPdf } = await import("./lib/pdf-builder");
        const pdfBuffer = await buildPdf(html, {
          title: docTitle,
          lang: docLang,
          author: docAuthor,
        });

        const filename = sanitizeHeaderFilename(
          conversion.originalFilename
            .replace(/\.pdf$/i, "")
            .replace(/[^\w\s.-]/g, "_") + "-accessible.pdf"
        );
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.setHeader("Content-Length", pdfBuffer.length);
        res.end(pdfBuffer);
      } catch (err) {
        console.error("PDF conversion error:", err);
        res.status(500).json({ error: "Failed to generate PDF file" });
      } finally {
        activePdfExports--;
      }
    },
  );

  return httpServer;
}

function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let currentText = text;

  const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*|__([^_]+)__|_([^_]+)_)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(
        new TextRun({ text: text.slice(lastIndex, match.index), size: 22 }),
      );
    }

    if (match[2]) {
      runs.push(new TextRun({ text: match[2], bold: true, size: 22 }));
    } else if (match[3]) {
      runs.push(new TextRun({ text: match[3], italics: true, size: 22 }));
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4], bold: true, size: 22 }));
    } else if (match[5]) {
      runs.push(new TextRun({ text: match[5], italics: true, size: 22 }));
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex), size: 22 }));
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text, size: 22 }));
  }

  return runs;
}
