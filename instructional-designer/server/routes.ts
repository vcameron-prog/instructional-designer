import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { insertCourseSchema, type Course, type InsertCourse, courses, generatedContent, contentVersions } from "@shared/schema";
import { users } from "@shared/models/auth";
import {
  setupAuth,
  registerAuthRoutes,
  isAuthenticated,
  isBsuAuthenticated,
  optionalAuth,
} from "./replit_integrations/auth";
import Anthropic from "@anthropic-ai/sdk";
import multer from "multer";
import { z } from "zod";
import { db } from "./db";
import { eq, and, desc, isNull, sql, inArray, ne } from "drizzle-orm";
import { convertMarkdownTablesToHtml } from "./markdownTableConverter.js";
import { parseVersionHistoryLimit } from "./lib/parseVersionHistoryLimit.js";
import {
  checkSharedRateLimit,
  checkAiGenRateLimit,
  AI_GEN_RATE_LIMIT,
  AI_GEN_RATE_WINDOW_MS,
  ANON_RATE_LIMIT,
  ANON_RATE_WINDOW_MS,
  SHARED_ANON_UPLOAD_RATE_LIMIT,
  checkAnonRateLimit,
} from "./lib/rateLimiters.js";
import { buildContentDocx } from "./lib/content-docx.js";

function getUserId(req: Request): string | null {
  return (req.user as any)?.claims?.sub ?? null;
}

function getVisitorToken(req: Request): string | null {
  return (req.session as any)?.visitorToken ?? null;
}

function ensureVisitorToken(req: Request): string {
  const session = req.session as any;
  if (!session.visitorToken) {
    session.visitorToken = randomUUID();
  }
  return session.visitorToken;
}

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

const VERSION_HISTORY_LIMIT: number = parseVersionHistoryLimit(process.env.VERSION_HISTORY_LIMIT);

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

// Generate prompt based on tool and course info
function generatePrompt(
  toolId: string,
  toolData: Record<string, any>,
  course: Course | null,
  language = "English",
): string {
  const syllabusContext = course?.existingSyllabus
    ? `\n\nEXISTING SYLLABUS CONTENT (use this to maintain consistency with the course's established structure, topics, assessments, and terminology):\n${course.existingSyllabus}`
    : "";

  const languageInstruction =
    language && language !== "English"
      ? `\n**OUTPUT LANGUAGE — MANDATORY:** Generate ALL content (headings, body text, labels, examples, instructions) entirely in ${language}. Do not switch to English at any point.\n`
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
- LANGUAGE: If outputting a full HTML document, include the appropriate BCP 47 language tag on the <html> element (e.g., lang="en" for English, lang="es" for Spanish, lang="fr" for French, lang="pt" for Portuguese, lang="ht" for Haitian Creole). Match the output language of the document.
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

  const outputDetail = ((toolData.outputDetail as string) || "concise").toLowerCase();
  const isConcise = outputDetail !== "standard";

  let inclusiveDesignSection = "";
  if (hasAnyInclusive && !isConcise) {
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

  const conciseGuidance = isConcise
    ? `\n**OUTPUT DETAIL — CONCISE MODE:**
Produce focused, practical output. Cover only the 3–4 most essential sections.
- Keep bullet points to 2–4 items per section
- Omit dedicated inclusive design research-citation blocks; weave accessibility and equity naturally where relevant
- Avoid exhaustive resource lists, extensive timelines, milestones, and padding
- Aim for output a busy faculty member can read in under 3 minutes\n`
    : "";

  const prompts: Record<string, string> = {
    assignment: `${assignmentBaseContext}
${durationGuidance}${conciseGuidance}
${isConcise
  ? `Create a focused, ready-to-use assignment covering:
1. Clear title and overview
2. Learning objectives (2–3 key outcomes)
3. Step-by-step instructions
4. Submission requirements for Blackboard Ultra
5. Grading criteria overview${hasAnyInclusive ? `\nWeave ${inclusiveOptions.join(", ")} principles naturally into the instructions where relevant.` : ""}`
  : `Create a COMPLETE assignment that includes:
1. Clear title and overview
2. Detailed learning objectives
3. Comprehensive step-by-step instructions
4. Submission requirements for Blackboard Ultra
5. Grading criteria overview
6. Resources and support materials
${!isShortDuration ? "7. Timeline and milestones" : ""}
${inclusiveDesignSection}`}

Assignment Type: ${toolData.assignmentType}
Learning Objectives: ${toolData.learningObjectives}
Duration: ${duration}
${hasAnyInclusive ? `Selected Inclusive Design Frameworks: ${inclusiveOptions.join(", ")}` : ""}
Additional Context: ${toolData.additionalContext || "None"}`,

    rubric: `${baseContext}
${conciseGuidance}
${isConcise
  ? `Create a focused rubric with:
1. Clear title and purpose
2. Criteria descriptions with observable behaviors for each level
3. Performance level descriptors (${toolData.levels})
4. Point values totaling ${toolData.totalPoints} points
Use supportive, growth-oriented language throughout.`
  : `Create a COMPLETE rubric with:
1. Clear title and purpose
2. Detailed criteria descriptions
3. Performance level descriptors (${toolData.levels})
4. Point values totaling ${toolData.totalPoints} points
5. Specific observable behaviors for each level
6. Ready for Blackboard Ultra

**INCLUSIVE DESIGN CONSIDERATIONS** (weave these into the rubric criteria):
7. **UDL-Aligned Criteria**: Criteria that allow diverse approaches to demonstrating mastery, not just one "right way"
8. **Culturally Responsive Assessment**: Criteria free from cultural bias, recognizing diverse communication styles and perspectives
9. **Growth-Oriented Language**: Use supportive, developmental framing that emphasizes learning over judgment`}

Assessment Type: ${toolData.assessmentType}
Total Points: ${toolData.totalPoints}
Criteria: ${toolData.criteria}
Additional Context: ${toolData.additionalContext || "None"}`,

    module: `${baseContext}
${conciseGuidance}
${isConcise
  ? `Create a focused module outline with:
1. Module title and overview
2. Learning outcomes (3–4 key outcomes)
3. Week-by-week content breakdown
4. Key learning activities with brief instructions
5. Assessment components
Weave UDL, cultural relevance, and SEL naturally into activities where appropriate.`
  : `Create a COMPLETE module with:
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
    - Stress management and pacing considerations`}

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
${conciseGuidance}
${isConcise
  ? `Create a focused course schedule with actual calendar dates:
1. Week-by-week breakdown with specific dates
2. Topics and key readings/materials
3. Assignment and assessment due dates
4. Breaks and holidays
Avoid clustering deadlines and note major observances inline where relevant.`
  : `Create a COMPREHENSIVE course schedule with ACTUAL CALENDAR DATES:
1. Week-by-week breakdown with specific dates
2. Topics and learning objectives
3. Readings and materials
4. Assignments with due dates
5. Assessment schedule
6. Account for breaks and holidays

**INCLUSIVE DESIGN CONSIDERATIONS** (integrate into the schedule):
7. **UDL Pacing**: Build in flexibility, avoid clustering too many deadlines
8. **Cultural Awareness**: Note major religious/cultural observances, consider diverse heritage months
9. **SEL-Informed Timing**: Include lighter weeks after intensive periods, build in check-in points for student wellbeing`}

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
${conciseGuidance}
Perform an alignment analysis between learning outcomes and assessments.

COURSE LEARNING OUTCOMES:
${toolData.learningOutcomes}

ASSIGNMENTS AND ASSESSMENTS:
${toolData.assignments}

ANALYSIS REQUESTED:
${toolData.checkType?.map((c: string) => `- ${c}`).join("\n") || "Full alignment check"}

ADDITIONAL CONTEXT: ${toolData.additionalContext || "None"}

${isConcise
  ? `Please provide:
1. **Alignment Matrix** - Show which assignments assess which outcomes (use an accessible HTML table or bold-label list)
2. **Gap Identification** - Any outcomes not assessed or under-assessed
3. **Recommendations** - Specific, actionable suggestions to improve alignment
4. **Strengths** - What's working well

Note equity considerations and UDL opportunities inline where relevant.
Format the matrix clearly so it can be used for accreditation documentation.`
  : `Please provide:
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

Format the matrix clearly so it can be used for accreditation documentation or course improvement.`}`,

    grading: `${baseContext}
${conciseGuidance}
Design an equitable grading policy based on Grading for Equity principles (Joe Feldman) that measures student content knowledge rather than compliance behaviors.

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

Create a ${isConcise ? "focused" : "comprehensive"} grading policy that includes:

${isConcise
  ? `1. **GRADING PHILOSOPHY STATEMENT** — brief rationale grounded in equitable grading research
2. **GRADE BREAKDOWN** — recommended weights with rationale
3. **LATE WORK & REVISION POLICY** — equitable approach that doesn't penalize life circumstances
4. **GRADING SCALE** — recommended scale with clear criteria
5. **SAMPLE SYLLABUS LANGUAGE** — ready-to-use policy text

Weave UDL, culturally responsive, and equity considerations naturally into each section.

Make the policy:
- Grounded in Grading for Equity research (Joe Feldman)
- Practical and implementable
- Ready to paste into syllabus`
  : `1. **GRADING PHILOSOPHY STATEMENT**
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
- Supportive of student learning while maintaining rigor`}`,

    airesistant: `${baseContext}
${conciseGuidance}
You are an expert in academic integrity and authentic assessment design. Analyze the following assignment for its vulnerability to AI-generated completion, and provide specific, research-based strategies to make it more AI-resistant while maintaining educational value.

EXISTING ASSIGNMENT:
${toolData.existingAssignment}

ASSIGNMENT TYPE: ${toolData.assignmentType}

ANALYSIS REQUESTED:
${toolData.whatYouWant?.map((w: string) => `- ${w}`).join("\n") || "Full analysis"}

CONSTRAINTS TO CONSIDER:
${toolData.constraints?.map((c: string) => `- ${c}`).join("\n") || "None specified"}

ADDITIONAL CONTEXT: ${toolData.additionalContext || "None"}

Provide a ${isConcise ? "focused" : "comprehensive"} analysis with the following sections:

${isConcise
  ? `## 1. AI VULNERABILITY ASSESSMENT

**Vulnerability Score: [LOW / MEDIUM / HIGH / VERY HIGH]**

Briefly note what AI can easily do vs. what it would struggle with on this specific assignment.

## 2. AI-RESISTANT ENHANCEMENT STRATEGIES

Recommend 3–5 specific, high-impact changes using evidence-based strategies (lived experience, process documentation, hyperlocal content, metacognitive reflection). For each, give a concrete example.

## 3. REVISED ASSIGNMENT (If Requested)

Provide a rewritten version incorporating the recommended changes. Maintain original learning objectives and keep workload reasonable.

**Key Principle:** Authentic assessment that measures genuine student learning naturally resists AI completion.

Format all output clearly with headers and bullet points.`
  : `## 1. AI VULNERABILITY ASSESSMENT

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

Format all output clearly with headers and bullet points for easy reading.`}`,

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
${conciseGuidance}
Design a${isConcise ? "" : " COMPLETE"} AI-POWERED STUDENT ACTIVITY where students intentionally use AI as a learning tool. Grounded in evidence-based AI pedagogy research (EDUCAUSE 2025, Mollick & Mollick 2023, Bowen & Watson 2024, UNESCO 2023).

${isConcise
  ? `Create a focused, ready-to-implement activity that includes:

## 1. ACTIVITY TITLE AND OVERVIEW
- Clear title, brief overview of what students will do, and connection to learning objectives

## 2. LEARNING OBJECTIVES
- 2–3 content-specific objectives plus 1–2 AI literacy objectives (Bloom's level targeted)

## 3. STEP-BY-STEP STUDENT INSTRUCTIONS
- Numbered steps with AI interaction points clearly marked
- For each AI interaction: sample prompt, what to look for, how to evaluate the output critically

## 4. CRITICAL THINKING CHECKPOINTS
- 2–3 specific questions students must answer about the AI's output accuracy, gaps, or assumptions

## 5. SUBMISSION REQUIREMENTS
- What to submit, documentation of AI interactions, Blackboard Ultra format

Activity Type: ${toolData.activityType}
Learning Objectives: ${toolData.learningObjectives}
Recommended AI Tool: ${toolData.aiToolRecommendation || "Any AI Assistant"}
Student AI Experience Level: ${toolData.studentLevel || "Intermediate"}
Critical Thinking Focus Areas: ${toolData.criticalThinkingFocus?.join(", ") || "General critical thinking"}
Activity Guardrails: ${toolData.guardrails?.join(", ") || "Standard guardrails"}
Additional Context: ${toolData.additionalContext || "None"}`
  : `Create a comprehensive, ready-to-implement activity that includes ALL of the following sections:

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
Additional Context: ${toolData.additionalContext || "None"}`}`,
  };

  return (prompts[toolId] || baseContext) + languageInstruction;
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

  if (process.env.NODE_ENV !== "production") {
    app.post("/api/test/login", async (req: Request, res: Response) => {
      const { sub, email, firstName, lastName } = req.body as {
        sub: string;
        email: string;
        firstName?: string;
        lastName?: string;
      };
      if (!sub || !email) {
        res.status(400).json({ error: "sub and email are required" });
        return;
      }
      // Ensure the user row exists so foreign-key checks pass.
      await db.insert(users).values({
        id: sub,
        email,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
      }).onConflictDoUpdate({
        target: users.id,
        set: {
          email,
          firstName: firstName ?? null,
          lastName: lastName ?? null,
        },
      });
      // Write directly to req.session (bypassing Passport serialization) and
      // call session.save() so express-session commits the row and emits
      // Set-Cookie.  req.login() does not emit Set-Cookie over plain HTTP,
      // so we use the same pattern as the PLAYWRIGHT_TEST login endpoint.
      const sessionUser = {
        claims: {
          sub,
          email,
          first_name: firstName ?? "",
          last_name: lastName ?? "",
        },
        access_token: "playwright-test-token",
        refresh_token: "playwright-test-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 7200,
      };
      (req.session as any).passport = { user: sessionUser };
      req.session.save((err) => {
        if (err) {
          res.status(500).json({ error: String(err) });
          return;
        }
        res.json({ ok: true, sub, email, sessionId: req.sessionID });
      });
    });

    app.post("/api/test/seed-content", async (req: Request, res: Response) => {
      const { courseId, userId, toolType, toolName, formData, content } =
        req.body as {
          courseId: number;
          userId: string;
          toolType: string;
          toolName: string;
          formData: Record<string, string>;
          content: string;
        };
      try {
        const item = await storage.createContent({
          courseId,
          userId,
          toolType,
          toolName,
          formData,
          content,
          isApproved: false,
        });
        res.status(201).json(item);
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // ---------------------------------------------------------------------------
    // Admin-specific helper: inject a pre-authenticated admin session so the
    // admin-dashboard Playwright test can skip the full OIDC flow.
    // ---------------------------------------------------------------------------
    app.get("/api/test/admin-login", (req: Request, res: Response) => {
      const adminIds = getAdminIds();
      const adminId = adminIds[0];
      if (!adminId) {
        res.status(400).json({ error: "ADMIN_USER_IDS is not configured" });
        return;
      }
      const user = {
        claims: {
          sub: adminId,
          email: adminId.includes("@") ? adminId : `${adminId}@test.invalid`,
          first_name: "Admin",
          last_name: "E2E",
        },
        access_token: "test-access-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };
      req.login(user, (err) => {
        if (err) {
          res.status(500).json({ error: String(err) });
          return;
        }
        res.json({ ok: true, adminId });
      });
    });

    // POST /api/test/login
    // Creates a server-side session for a synthetic BSU user without going
    // through the real Replit OIDC flow.  Disabled in production.
    app.post("/api/test/login", async (req: Request, res: Response) => {
      const { sub, email, firstName, lastName } = req.body as {
        sub: string;
        email: string;
        firstName?: string;
        lastName?: string;
      };
      if (!sub || !email) {
        res.status(400).json({ error: "sub and email are required" });
        return;
      }
      await db
        .insert(users)
        .values({ id: sub, email, firstName: firstName ?? null, lastName: lastName ?? null })
        .onConflictDoUpdate({
          target: users.id,
          set: { email, firstName: firstName ?? null, lastName: lastName ?? null },
        });

      const sessionUser = {
        claims: {
          sub,
          email,
          first_name: firstName ?? "",
          last_name: lastName ?? "",
        },
        access_token: "playwright-test-token",
        refresh_token: "playwright-test-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 7200,
      };

      (req.session as any).passport = { user: sessionUser };
      req.session.save((err) => {
        if (err) {
          res.status(500).json({ error: String(err) });
          return;
        }
        res.json({ ok: true, sub, email, sessionId: req.sessionID });
      });
    });

    // PATCH /api/test/set-syllabus-date/:courseId
    // Sets syllabusUploadedAt on a course to the current timestamp (or a
    // provided ISO string).  Disabled in production.
    app.patch("/api/test/set-syllabus-date/:courseId", async (req: Request, res: Response) => {
      const id = parseInt(req.params.courseId as string, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: "courseId must be a number" });
        return;
      }
      const { syllabusUploadedAt } = req.body as { syllabusUploadedAt?: string };
      const uploadedAt = syllabusUploadedAt ? new Date(syllabusUploadedAt) : new Date();
      const [row] = await db
        .update(courses)
        .set({ syllabusUploadedAt: uploadedAt })
        .where(eq(courses.id, id))
        .returning();
      if (!row) {
        res.status(404).json({ error: "Course not found" });
        return;
      }
      res.json({ id: row.id, syllabusUploadedAt: row.syllabusUploadedAt });
    });
  }

  // User preferences — authenticated users only
  app.get("/api/preferences", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    try {
      const prefs = await storage.getUserPreferences(userId);
      res.json(prefs ?? {});
    } catch (err) {
      console.error("[preferences] GET error:", err);
      res.status(500).json({ message: "Failed to fetch preferences" });
    }
  });

  app.patch("/api/preferences", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const allowedKeys = new Set(["skipPreview", "autoExpand", "defaultLanguage", "preferredTool"]);
    const patch = req.body as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (allowedKeys.has(k)) sanitized[k] = v;
    }

    try {
      const existing = (await storage.getUserPreferences(userId)) ?? {};
      const merged = { ...existing, ...sanitized };
      await storage.setUserPreferences(userId, merged);
      res.json(merged);
    } catch (err) {
      console.error("[preferences] PATCH error:", err);
      res.status(500).json({ message: "Failed to save preferences" });
    }
  });

  // Tool presets — authenticated users only, stored in the preferences JSONB column
  app.get("/api/presets/:toolId", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const toolId = req.params.toolId as string;
    if (!toolId) return res.status(400).json({ message: "toolId is required" });
    try {
      const prefs = (await storage.getUserPreferences(userId)) ?? {};
      const presetsMap = (prefs.presets as Record<string, unknown>) ?? {};
      const toolPresets = presetsMap[toolId] ?? [];
      res.json(toolPresets);
    } catch (err) {
      console.error("[presets] GET error:", err);
      res.status(500).json({ message: "Failed to fetch presets" });
    }
  });

  app.put("/api/presets/:toolId", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const toolId = req.params.toolId as string;
    if (!toolId) return res.status(400).json({ message: "toolId is required" });
    if (!Array.isArray(req.body)) return res.status(400).json({ message: "Body must be an array" });
    const MAX_PRESETS = 50;
    const presets = (req.body as unknown[]).slice(0, MAX_PRESETS);
    try {
      const existing = (await storage.getUserPreferences(userId)) ?? {};
      const existingPresetsMap = (existing.presets as Record<string, unknown>) ?? {};
      const merged = { ...existing, presets: { ...existingPresetsMap, [toolId]: presets } };
      await storage.setUserPreferences(userId, merged);
      res.json(presets);
    } catch (err) {
      console.error("[presets] PUT error:", err);
      res.status(500).json({ message: "Failed to save presets" });
    }
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
    "/api/admin/stats/export",
    isAuthenticated,
    isAdmin,
    async (_req: Request, res: Response) => {
      try {
        const escape = (v: string | number | null | undefined) => {
          const s = v == null ? "" : String(v);
          return s.includes(",") || s.includes('"') || s.includes("\n")
            ? `"${s.replace(/"/g, '""')}"`
            : s;
        };
        const row = (...cells: (string | number | null | undefined)[]) =>
          cells.map(escape).join(",");

        const exportLines: string[] = [];

        const [
          totalCoursesResult,
          totalContentResult,
          totalUsersResult,
          toolResult,
          userActivityResult,
        ] = await Promise.all([
          db.select({ count: sql<number>`count(*)::int` }).from(courses),
          db.select({ count: sql<number>`count(*)::int` }).from(generatedContent),
          db.select({ count: sql<number>`count(*)::int` }).from(users),
          db
            .select({ name: generatedContent.toolName, count: sql<number>`count(*)::int` })
            .from(generatedContent)
            .groupBy(generatedContent.toolName)
            .orderBy(sql`count(*) desc`),
          db
            .select({
              userId: users.id,
              email: users.email,
              firstName: users.firstName,
              lastName: users.lastName,
              courseCount: sql<number>`(select count(*) from courses where user_id = users.id)::int`,
              contentCount: sql<number>`(select count(*) from generated_content where user_id = users.id)::int`,
            })
            .from(users)
            .orderBy(sql`(select count(*) from courses where user_id = users.id) + (select count(*) from generated_content where user_id = users.id) desc`)
            .limit(100),
        ]);

        exportLines.push("BSU Instructional Designer — Usage Export");
        exportLines.push(`Generated: ${new Date().toISOString()}`);
        exportLines.push("");
        exportLines.push("## SUMMARY");
        exportLines.push(row("Metric", "Value"));
        exportLines.push(row("Total Courses", totalCoursesResult[0]?.count ?? 0));
        exportLines.push(row("Content Generated", totalContentResult[0]?.count ?? 0));
        exportLines.push(row("Total Users", totalUsersResult[0]?.count ?? 0));
        exportLines.push("");
        exportLines.push("## TOOL POPULARITY");
        exportLines.push(row("Tool", "Uses"));
        for (const t of toolResult) {
          exportLines.push(row(t.name, t.count));
        }
        exportLines.push("");
        exportLines.push("## USER ACTIVITY");
        exportLines.push(row("Email", "First Name", "Last Name", "Courses", "Content", "Total"));
        for (const u of userActivityResult) {
          const total = (u.courseCount ?? 0) + (u.contentCount ?? 0);
          if (total === 0) continue;
          exportLines.push(row(u.email, u.firstName, u.lastName, u.courseCount, u.contentCount, total));
        }

        const csv = exportLines.join("\r\n");
        const filename = `bsu-id-export-${new Date().toISOString().split("T")[0]}.csv`;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send("\uFEFF" + csv);
      } catch (err: any) {
        res.status(500).json({ error: err.message || "Export failed" });
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
          totalUsersResult,
          activeUsersResult,
          monthlyCoursesResult,
          monthlyContentResult,
          toolBreakdownResult,
          recentCoursesResult,
          recentContentResult,
          userActivityResult,
          refinementsResult,
        ] = await Promise.all([
          db.select({ count: sql<number>`count(*)` }).from(courses),
          db.select({ count: sql<number>`count(*)` }).from(generatedContent),
          db.select({ count: sql<number>`count(*)` }).from(users),
          db.select({ count: sql<number>`count(*)` }).from(sql`(
            SELECT DISTINCT user_id FROM courses WHERE to_char(created_at, 'YYYY-MM') = ${months[5]} AND user_id IS NOT NULL
            UNION
            SELECT DISTINCT user_id FROM generated_content WHERE to_char(created_at, 'YYYY-MM') = ${months[5]} AND user_id IS NOT NULL
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
            toolName: generatedContent.toolName,
            count: sql<number>`count(*)`,
          }).from(generatedContent)
            .groupBy(generatedContent.toolName)
            .orderBy(sql`count(*) desc`),
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
          ) AS all_users`)
            .groupBy(sql`user_id`),
          db.select({ count: sql<number>`count(*)` }).from(contentVersions),
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

        const monthlyTrends = months.map(m => {
          const c = monthlyCoursesResult.find(r => r.month === m);
          const g = monthlyContentResult.find(r => r.month === m);
          return {
            month: m,
            courses: Number(c?.count ?? 0),
            content: Number(g?.count ?? 0),
            conversions: 0,
          };
        });

        res.json({
          summary: {
            totalCourses: Number(totalCoursesResult[0]?.count ?? 0),
            totalContent: Number(totalContentResult[0]?.count ?? 0),
            totalConversions: 0,
            totalUsers: Number(totalUsersResult[0]?.count ?? 0),
            activeUsersThisMonth: Number(activeUsersResult[0]?.count ?? 0),
            totalRefinements: Number(refinementsResult[0]?.count ?? 0),
          },
          monthlyTrends,
          toolBreakdown: toolBreakdownResult.map(t => ({
            name: t.toolName,
            count: Number(t.count),
          })),
          conversionStats: { byStatus: {}, bySourceType: {}, ocrUsed: 0 },
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
            conversionCount: 0,
          })).sort((a, b) => (b.courseCount + b.contentCount) - (a.courseCount + a.contentCount)),
          accessibilityStats: {
            aiChecksRun: 0,
            conversionsWithReport: 0,
            avgFinalScore: null,
            avgOriginalScore: null,
            totalIssuesFound: 0,
            totalIssuesFixed: 0,
            totalIssuesRemaining: 0,
          },
          config: {
            versionHistoryLimit: VERSION_HISTORY_LIMIT,
            anonRateLimit: ANON_RATE_LIMIT,
            statsApiKeySet: Boolean(process.env.STATS_API_KEY),
            adminUserCount: getAdminIds().length,
          },
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

        const [coursesResult, contentResult] = await Promise.all([
          db.select({ count: sql<number>`count(*)` })
            .from(courses)
            .where(sql`to_char(created_at, 'YYYY-MM') = ${month}`),
          db.select({ count: sql<number>`count(*)` })
            .from(generatedContent)
            .where(sql`to_char(created_at, 'YYYY-MM') = ${month}`),
        ]);

        res.json({
          month,
          coursesCreated: Number(coursesResult[0]?.count ?? 0),
          contentGenerated: Number(contentResult[0]?.count ?? 0),
          documentsConverted: 0,
          accessibilityChecksRun: 0,
          totalActivity:
            Number(coursesResult[0]?.count ?? 0) +
            Number(contentResult[0]?.count ?? 0),
        });
      } catch (error) {
        console.error("Error fetching stats:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
      }
    },
  );

  // Courses API (BSU faculty only)
  app.get(
    "/api/courses",
    isBsuAuthenticated,
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
    isBsuAuthenticated,
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
    isBsuAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const parsed = insertCourseSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: parsed.error.message });
        }
        const courseData: InsertCourse & { syllabusUploadedAt?: Date } = { ...parsed.data };
        if (parsed.data.existingSyllabus && parsed.data.existingSyllabus !== "") {
          courseData.syllabusUploadedAt = new Date();
        }
        const course = await storage.createCourse(courseData, userId);
        res.status(201).json(course);
      } catch (error) {
        console.error("Error creating course:", error);
        res.status(500).json({ error: "Failed to create course" });
      }
    },
  );

  app.patch(
    "/api/courses/:id",
    isBsuAuthenticated,
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
        const updateData: Partial<typeof parsed.data> & { syllabusUploadedAt?: Date | null } = { ...parsed.data };
        if ("existingSyllabus" in parsed.data) {
          const existing = await storage.getCourse(id, userId);
          if (existing) {
            const incomingSyllabus = parsed.data.existingSyllabus ?? "";
            const currentSyllabus = existing.existingSyllabus ?? "";
            if (incomingSyllabus !== currentSyllabus) {
              updateData.syllabusUploadedAt = incomingSyllabus !== "" ? new Date() : null;
            }
          }
        }
        const course = await storage.updateCourse(id, updateData, userId);
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
    isBsuAuthenticated,
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

  // Generated Content API (BSU faculty only)
  app.get(
    "/api/courses/:id/content",
    isBsuAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const courseId = parseInt(req.params.id as string);

        // Verify course ownership
        const course = await storage.getCourse(courseId, userId);
        if (!course) {
          return res.status(404).json({ error: "Course not found" });
        }

        let content = await storage.getContentByCourse(courseId);

        const toolTypeParam = req.query.toolType;
        if (toolTypeParam) {
          const toolTypes = Array.isArray(toolTypeParam)
            ? (toolTypeParam as string[])
            : (toolTypeParam as string).split(",").map((s) => s.trim());
          content = content.filter((c) => toolTypes.includes(c.toolType));
        }

        res.json(content);
      } catch (error) {
        console.error("Error fetching content:", error);
        res.status(500).json({ error: "Failed to fetch content" });
      }
    },
  );

  // Tool usage for a course — returns distinct toolType values for which at
  // least one piece of generated content exists. Restricted to the course owner.
  app.get(
    "/api/courses/:id/tool-usage",
    isBsuAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const courseId = parseInt(req.params.id as string);

        const course = await storage.getCourse(courseId, userId);
        if (!course) {
          return res.status(404).json({ error: "Course not found" });
        }

        const usedTools = await storage.getToolUsage(courseId, userId);
        res.json({ usedTools });
      } catch (error) {
        console.error("Error fetching tool usage:", error);
        res.status(500).json({ error: "Failed to fetch tool usage" });
      }
    },
  );

  app.get(
    "/api/content/:id",
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
          if (!course) {
            return res.status(404).json({ error: "Content not found" });
          }
        } else if (content.userId) {
          if (content.userId !== userId) return res.status(403).json({ error: "Unauthorized" });
        } else {
          const vToken = getVisitorToken(req);
          if (!vToken || vToken !== content.visitorToken) {
            return res.status(403).json({ error: "Unauthorized" });
          }
        }

        res.json(content);
      } catch (error) {
        console.error("Error fetching content:", error);
        res.status(500).json({ error: "Failed to fetch content" });
      }
    },
  );

  // Delete a specific content item (owner-scoped)
  app.delete(
    "/api/content/:id",
    optionalAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id as string);
        if (isNaN(id)) {
          return res.status(400).json({ error: "Invalid content id" });
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
        } else if (content.userId) {
          if (content.userId !== userId) return res.status(403).json({ error: "Unauthorized" });
        } else {
          const vToken = getVisitorToken(req);
          if (!vToken || vToken !== content.visitorToken) {
            return res.status(403).json({ error: "Unauthorized" });
          }
          await storage.deleteContent(id, null, vToken);
          return res.status(204).send();
        }

        await storage.deleteContent(id, userId);
        res.status(204).send();
      } catch (error) {
        console.error("Error deleting content:", error);
        res.status(500).json({ error: "Failed to delete content" });
      }
    },
  );

  // Toggle content approval for connected materials
  app.patch(
    "/api/content/:id/approval",
    isBsuAuthenticated,
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
        if (!content.userId && !content.courseId) {
          return res.status(403).json({ error: "Anonymous content cannot be approved" });
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

  // Generate content using AI (BSU faculty only)
  app.post(
    "/api/courses/:id/generate",
    isBsuAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const courseId = parseInt(req.params.id as string);
        const { toolId, toolName, formData, language } = req.body;

        const course = await storage.getCourse(courseId, userId);
        if (!course) {
          return res.status(404).json({ error: "Course not found" });
        }

        if (!await checkSharedRateLimit(userId, "ai-gen", AI_GEN_RATE_LIMIT, AI_GEN_RATE_WINDOW_MS, () => checkAiGenRateLimit(userId))) {
          return res.status(429).json({ error: "AI generation rate limit exceeded. Please try again later." });
        }

        const prompt = generatePrompt(toolId, formData, course, language);

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
        const { toolId, toolName, formData, language } = req.body;

        if (userId) {
          if (!await checkSharedRateLimit(userId, "ai-gen", AI_GEN_RATE_LIMIT, AI_GEN_RATE_WINDOW_MS, () => checkAiGenRateLimit(userId))) {
            return res.status(429).json({ error: "AI generation rate limit exceeded. Please try again later." });
          }
        } else {
          const ip = req.ip || req.socket.remoteAddress || "unknown";
          if (!await checkSharedRateLimit(`ip:${ip}`, "ai-gen", ANON_RATE_LIMIT, ANON_RATE_WINDOW_MS, () => checkAnonRateLimit(ip))) {
            return res.status(429).json({ error: "Rate limit exceeded. Please try again later." });
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

        const prompt = generatePrompt(toolId, formData, null, language);

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
        const visitorToken = userId ? null : ensureVisitorToken(req);

        const content = await storage.createContent({
          courseId: null,
          userId,
          visitorToken,
          toolType: toolId,
          toolName,
          formData,
          content: generatedText,
        });
        return res.status(201).json(content);
      } catch (error) {
        console.error("Error generating standalone content:", error);
        res.status(500).json({ error: "Failed to generate content" });
      }
    },
  );

  // Batch generation: assignment + matching rubric in one request (standalone or course-based)
  app.post(
    "/api/generate-batch-assignment-rubric",
    isBsuAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const { formData, rubricConfig, courseId: rawCourseId } = req.body;

        let resolvedCourseId: number | null = null;
        if (rawCourseId) {
          const courseIdNum = parseInt(String(rawCourseId), 10);
          if (isNaN(courseIdNum)) {
            return res.status(400).json({ error: "Invalid courseId" });
          }
          const course = await storage.getCourse(courseIdNum, userId);
          if (!course) {
            return res.status(404).json({ error: "Course not found" });
          }
          resolvedCourseId = courseIdNum;
        }

        if (!checkAiGenRateLimit(userId)) {
          return res.status(429).json({ error: "AI generation rate limit exceeded. Please try again later." });
        }

        const assignmentPrompt = generatePrompt("assignment", formData, resolvedCourseId ? await storage.getCourse(resolvedCourseId, userId) || null : null);

        const assignmentMessage = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 8192,
          messages: [{ role: "user", content: assignmentPrompt }],
        });

        const rawAssignmentText = assignmentMessage.content
          .filter((item): item is Anthropic.TextBlock => item.type === "text")
          .map((item) => item.text)
          .join("\n\n");

        const assignmentText = convertMarkdownTablesToHtml(rawAssignmentText);

        // Build rubric prompt derived from the assignment text — do this before
        // any DB writes so that if the rubric AI call fails we haven't saved an
        // orphan assignment record yet.
        const rubricFormData = {
          assessmentType: formData.assignmentType || "Assignment",
          totalPoints: rubricConfig?.totalPoints || "100",
          levels: rubricConfig?.levels || "4 levels",
          criteria: formData.learningObjectives || "",
          additionalContext: `This rubric is for the following assignment:\n\n${assignmentText.slice(0, 2000)}`,
        };
        const rubricPrompt = generatePrompt("rubric", rubricFormData, null);

        const rubricMessage = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 8192,
          messages: [{ role: "user", content: rubricPrompt }],
        });

        const rawRubricText = rubricMessage.content
          .filter((item): item is Anthropic.TextBlock => item.type === "text")
          .map((item) => item.text)
          .join("\n\n");

        const rubricText = convertMarkdownTablesToHtml(rawRubricText);

        // Both AI calls succeeded — now persist both records. Any DB error here
        // is transient infrastructure, not a duplicate-charge risk.
        const assignmentContent = await storage.createContent({
          courseId: resolvedCourseId,
          userId,
          toolType: "assignment",
          toolName: "Assignment Design",
          formData,
          content: assignmentText,
        });

        const rubricContent = await storage.createContent({
          courseId: resolvedCourseId,
          userId,
          toolType: "rubric",
          toolName: "Rubric Builder",
          formData: rubricFormData,
          content: rubricText,
        });

        return res.status(201).json({
          assignmentId: assignmentContent.id,
          rubricId: rubricContent.id,
        });
      } catch (error) {
        console.error("Error generating batch assignment+rubric:", error);
        res.status(500).json({ error: "Failed to generate content" });
      }
    },
  );

  // Get standalone content for user (BSU faculty only)
  app.get(
    "/api/standalone-content",
    isBsuAuthenticated,
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

  // Get recent quick-tool results for the current user (last 10, with truncated preview)
  app.get(
    "/api/content/recent-quick-tools",
    isBsuAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const items = await storage.getRecentStandaloneContent(userId, 10);
        const results = items.map((item) => ({
          id: item.id,
          toolType: item.toolType,
          toolName: item.toolName,
          createdAt: item.createdAt,
          formData: item.formData,
          contentPreview: item.content.replace(/^#+\s.*$/gm, "").replace(/\*\*/g, "").replace(/\n+/g, " ").trim().slice(0, 120),
        }));
        res.json(results);
      } catch (error) {
        console.error("Error fetching recent quick tools:", error);
        res.status(500).json({ error: "Failed to fetch recent results" });
      }
    },
  );

  // Get single standalone content item (BSU faculty only)
  app.get(
    "/api/standalone-content/:id",
    isBsuAuthenticated,
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

  // Refine content (BSU faculty only)
  app.post(
    "/api/content/:id/refine",
    isBsuAuthenticated,
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
        } else if (!content.userId || content.userId !== userId) {
          return res.status(403).json({ error: "Forbidden" });
        }

        if (!await checkSharedRateLimit(userId, "ai-gen", AI_GEN_RATE_LIMIT, AI_GEN_RATE_WINDOW_MS, () => checkAiGenRateLimit(userId))) {
          return res.status(429).json({ error: "AI generation rate limit exceeded. Please try again later." });
        }

        // Save current version
        await storage.createVersion({
          generatedContentId: id,
          content: content.content,
          refinementRequest: refinementRequest,
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
        } else if (content.userId) {
          if (content.userId !== userId) {
            return res.status(403).json({ error: "Unauthorized" });
          }
        } else {
          const vToken = getVisitorToken(req);
          if (!vToken || vToken !== content.visitorToken) {
            return res.status(403).json({ error: "Unauthorized" });
          }
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
        } else if (content.userId) {
          if (content.userId !== userId) return res.status(403).json({ error: "Unauthorized" });
        } else {
          const vToken = getVisitorToken(req);
          if (!vToken || vToken !== content.visitorToken) {
            return res.status(403).json({ error: "Unauthorized" });
          }
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
    async (req: Request, res: Response, next: NextFunction) => {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      // Cross-instance rate limit keyed by IP so token-rotation cannot bypass it.
      if (!await checkSharedRateLimit(`ip:${ip}`, "upload", SHARED_ANON_UPLOAD_RATE_LIMIT, ANON_RATE_WINDOW_MS, () => checkAnonRateLimit(ip))) {
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

  // Course duplication (BSU faculty only)
  app.post(
    "/api/courses/:id/duplicate",
    isBsuAuthenticated,
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

  // Semester rollover — creates a new course from an existing one with a new semester, optionally carrying forward selected content
  app.post(
    "/api/courses/:id/rollover",
    isBsuAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const id = parseInt(req.params.id as string);
        const { semester, contentIds } = z.object({
          semester: z.string().min(1),
          contentIds: z.array(z.number().int().positive()).optional().default([]),
        }).parse(req.body);
        const rolledOver = await storage.rolloverCourse(id, userId, semester);
        if (!rolledOver) {
          return res.status(404).json({ error: "Course not found" });
        }
        if (contentIds.length > 0) {
          try {
            await storage.copyContentItemsToNewCourse(contentIds, id, rolledOver.id, userId);
          } catch (copyError) {
            await storage.deleteCourse(rolledOver.id, userId).catch(() => {});
            throw copyError;
          }
        }
        res.status(201).json(rolledOver);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: "Invalid request: semester is required and contentIds must be an array of positive integers" });
        }
        console.error("Error rolling over course:", error);
        res.status(500).json({ error: "Failed to create new semester course" });
      }
    },
  );

  // Saved Content Library API (BSU faculty only)
  app.get(
    "/api/library",
    isBsuAuthenticated,
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
    isBsuAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const { title, toolType, content, description, formData, courseId } = req.body;
        const saved = await storage.createSavedContent({
          title,
          toolType,
          content,
          description,
          formData: formData ?? null,
          courseId: courseId ? parseInt(courseId) : null,
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
    isBsuAuthenticated,
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

  // Saved Outcomes API (personal faculty collection)
  app.get(
    "/api/outcomes",
    isBsuAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const outcomes = await storage.getSavedOutcomes(userId);
        res.json(outcomes);
      } catch (error) {
        console.error("Error fetching saved outcomes:", error);
        res.status(500).json({ error: "Failed to fetch saved outcomes" });
      }
    },
  );

  app.post(
    "/api/outcomes",
    isBsuAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const { text } = req.body;
        if (!text || typeof text !== "string" || !text.trim()) {
          return res.status(400).json({ error: "text is required" });
        }
        const outcome = await storage.createSavedOutcome(text.trim(), userId);
        res.status(201).json(outcome);
      } catch (error) {
        console.error("Error saving outcome:", error);
        res.status(500).json({ error: "Failed to save outcome" });
      }
    },
  );

  app.patch(
    "/api/outcomes/:id",
    isBsuAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const id = parseInt(req.params.id as string);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
        const { text } = req.body;
        if (!text || typeof text !== "string" || !text.trim()) {
          return res.status(400).json({ error: "text is required" });
        }
        const outcome = await storage.updateSavedOutcome(id, text.trim(), userId);
        res.json(outcome);
      } catch (error: any) {
        if (error?.code === "DUPLICATE_OUTCOME") {
          return res.status(409).json({ error: "An outcome with that text already exists in your collection." });
        }
        if (
          error instanceof Error &&
          error.message === "Outcome not found or not owned by user"
        ) {
          return res.status(404).json({ error: "Outcome not found" });
        }
        console.error("Error updating saved outcome:", error);
        res.status(500).json({ error: "Failed to update outcome" });
      }
    },
  );

  app.delete(
    "/api/outcomes/:id",
    isBsuAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const id = parseInt(req.params.id as string);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
        const deleted = await storage.deleteSavedOutcome(id, userId);
        if (deleted === 0) {
          return res.status(404).json({ error: "Outcome not found" });
        }
        res.status(204).send();
      } catch (error) {
        console.error("Error deleting saved outcome:", error);
        res.status(500).json({ error: "Failed to delete outcome" });
      }
    },
  );

  // Word Document Export (BSU faculty only)
  app.get(
    "/api/content/:id/export-docx",
    isBsuAuthenticated,
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
        } else if (!content.userId || content.userId !== userId) {
          return res.status(403).json({ error: "Forbidden" });
        }

        const buffer = await buildContentDocx(content, course);

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

  // Bulk ZIP Export — all generated content for a course
  app.get(
    "/api/courses/:courseId/export",
    isBsuAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req) as string;
        const courseId = parseInt(req.params.courseId as string);
        if (isNaN(courseId)) {
          return res.status(400).json({ error: "Invalid course ID" });
        }

        const course = await storage.getCourse(courseId, userId);
        if (!course) {
          return res.status(404).json({ error: "Course not found" });
        }

        let contentItems = await storage.getContentByCourse(courseId);
        if (contentItems.length === 0) {
          return res.status(404).json({ error: "No generated content found for this course" });
        }

        const idsParam = req.query.ids as string | undefined;
        if (idsParam) {
          const requestedIds = idsParam.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n));
          if (requestedIds.length > 0) {
            contentItems = contentItems.filter(item => requestedIds.includes(item.id));
          }
        }

        if (contentItems.length === 0) {
          return res.status(404).json({ error: "No matching content found for export" });
        }

        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();

        const filenameCounts: Record<string, number> = {};

        for (const item of contentItems) {
          const dateStr = new Date(item.createdAt).toISOString().slice(0, 10);
          const baseName = `${item.toolType.charAt(0).toUpperCase()}${item.toolType.slice(1)}-${dateStr}`;
          const count = filenameCounts[baseName] ?? 0;
          filenameCounts[baseName] = count + 1;
          const filename = count === 0 ? `${baseName}.docx` : `${baseName}-${count + 1}.docx`;

          const docxBuffer = await buildContentDocx(item, course);
          zip.file(filename, docxBuffer);
        }

        const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

        const zipFilename = sanitizeHeaderFilename(
          `${course.courseName.replace(/\s+/g, "_")}-Materials.zip`,
        );

        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${zipFilename}"`);
        res.send(zipBuffer);
      } catch (error) {
        console.error("Error exporting course materials as ZIP:", error);
        res.status(500).json({ error: "Failed to export course materials" });
      }
    },
  );

  return httpServer;
}
