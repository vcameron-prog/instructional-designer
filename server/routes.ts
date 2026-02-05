import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCourseSchema, type Course } from "@shared/schema";
import Anthropic from "@anthropic-ai/sdk";
import multer from "multer";
import { z } from "zod";
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
});

const upload = multer({ storage: multer.memoryStorage() });

// Generate prompt based on tool and course info
function generatePrompt(
  toolId: string,
  toolData: Record<string, any>,
  course: Course
): string {
  const syllabusContext = course.existingSyllabus
    ? `\n\nEXISTING SYLLABUS CONTENT (use this to maintain consistency with the course's established structure, topics, assessments, and terminology):\n${course.existingSyllabus}`
    : "";

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
Course: ${course.courseName} (${course.courseNumber})
Level: ${course.courseLevel}
Credits: ${course.credits}
Semester: ${course.semester}
Instructor: ${course.instructor}
Department: ${course.department}
Prerequisites: ${course.prerequisites || "None"}

Course Description: ${course.courseDescription}

Primary Learning Outcomes: ${course.learningOutcomes}

Additional Context: ${course.additionalContext || "None provided"}${syllabusContext}

**CRITICAL FORMATTING RULES - FOLLOW EXACTLY:**
- DO NOT use markdown table syntax (no |---|---| or | column | column | formats)
- Instead of tables, use clear formatted lists with labels
- Use **bold labels** followed by content on the same line or as sub-bullets
- For schedules and matrices, use numbered sections with clear headings
- Keep output clean and readable without complex formatting symbols`;

  const prompts: Record<string, string> = {
    assignment: `${baseContext}

Create a COMPLETE assignment that includes:
1. Clear title and overview
2. Detailed learning objectives
3. Comprehensive step-by-step instructions
4. Submission requirements for Blackboard Ultra
5. Grading criteria overview
6. Resources and support materials
7. Timeline and milestones

**INCLUSIVE DESIGN SECTION** (include this as a dedicated section in the output):
8. **UDL Accommodations**: Multiple ways to complete/submit the assignment, accessibility considerations
9. **Cultural Relevance**: How students can connect the assignment to their own backgrounds/experiences, diverse examples or options
10. **SEL Integration**: Reflection prompts, collaboration opportunities, how the assignment supports student growth and wellbeing

Assignment Type: ${toolData.assignmentType}
Learning Objectives: ${toolData.learningObjectives}
Duration: ${toolData.duration || "Flexible"}
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
${course.existingSyllabus || ""}
${toolData.currentSyllabusText || ""}
${!course.existingSyllabus && !toolData.currentSyllabusText ? "No existing syllabus provided - create a new syllabus based on the course information above." : ""}

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

3. **COURSE INFORMATION AT-A-GLANCE** (use formatted list with bold labels, NOT a table)
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

12. **COURSE SCHEDULE** (use week-by-week sections with bold labels, NOT a table)
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
   - List showing which policy level applies to each assignment type (use bold labels, NOT a table)
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
1. **Alignment Matrix** - A clear formatted list showing which assignments assess which outcomes (use bullet points with bold labels, NOT a table)
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
  };

  return prompts[toolId] || baseContext;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Courses API
  app.get("/api/courses", async (req: Request, res: Response) => {
    try {
      const courses = await storage.getAllCourses();
      res.json(courses);
    } catch (error) {
      console.error("Error fetching courses:", error);
      res.status(500).json({ error: "Failed to fetch courses" });
    }
  });

  app.get("/api/courses/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const course = await storage.getCourse(id);
      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }
      res.json(course);
    } catch (error) {
      console.error("Error fetching course:", error);
      res.status(500).json({ error: "Failed to fetch course" });
    }
  });

  app.post("/api/courses", async (req: Request, res: Response) => {
    try {
      const parsed = insertCourseSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const course = await storage.createCourse(parsed.data);
      res.status(201).json(course);
    } catch (error) {
      console.error("Error creating course:", error);
      res.status(500).json({ error: "Failed to create course" });
    }
  });

  app.patch("/api/courses/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      // Validate partial course data
      const partialSchema = insertCourseSchema.partial();
      const parsed = partialSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const course = await storage.updateCourse(id, parsed.data);
      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }
      res.json(course);
    } catch (error) {
      console.error("Error updating course:", error);
      res.status(500).json({ error: "Failed to update course" });
    }
  });

  app.delete("/api/courses/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteCourse(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting course:", error);
      res.status(500).json({ error: "Failed to delete course" });
    }
  });

  // Generated Content API
  app.get("/api/courses/:id/content", async (req: Request, res: Response) => {
    try {
      const courseId = parseInt(req.params.id);
      const content = await storage.getContentByCourse(courseId);
      res.json(content);
    } catch (error) {
      console.error("Error fetching content:", error);
      res.status(500).json({ error: "Failed to fetch content" });
    }
  });

  app.get("/api/content/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const content = await storage.getContent(id);
      if (!content) {
        return res.status(404).json({ error: "Content not found" });
      }
      res.json(content);
    } catch (error) {
      console.error("Error fetching content:", error);
      res.status(500).json({ error: "Failed to fetch content" });
    }
  });

  // Toggle content approval for connected materials
  app.patch("/api/content/:id/approval", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { isApproved } = req.body;
      
      if (typeof isApproved !== "boolean") {
        return res.status(400).json({ error: "isApproved must be a boolean" });
      }
      
      const content = await storage.toggleContentApproval(id, isApproved);
      if (!content) {
        return res.status(404).json({ error: "Content not found" });
      }
      res.json(content);
    } catch (error) {
      console.error("Error toggling content approval:", error);
      res.status(500).json({ error: "Failed to toggle approval" });
    }
  });

  // Generate content using AI
  app.post("/api/courses/:id/generate", async (req: Request, res: Response) => {
    try {
      const courseId = parseInt(req.params.id);
      const { toolId, toolName, formData } = req.body;

      const course = await storage.getCourse(courseId);
      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      const prompt = generatePrompt(toolId, formData, course);

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });

      const generatedText = message.content
        .filter((item): item is Anthropic.TextBlock => item.type === "text")
        .map((item) => item.text)
        .join("\n\n");

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
  });

  // Refine content
  app.post("/api/content/:id/refine", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { refinementRequest } = req.body;

      const content = await storage.getContent(id);
      if (!content) {
        return res.status(404).json({ error: "Content not found" });
      }

      // Save current version
      await storage.createVersion({
        generatedContentId: id,
        content: content.content,
        refinementRequest: "Previous version",
      });

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

      const refinedText = message.content
        .filter((item): item is Anthropic.TextBlock => item.type === "text")
        .map((item) => item.text)
        .join("\n\n");

      const updated = await storage.updateContent(id, refinedText);
      res.json(updated);
    } catch (error) {
      console.error("Error refining content:", error);
      res.status(500).json({ error: "Failed to refine content" });
    }
  });

  // File upload for syllabus
  app.post("/api/upload-syllabus", upload.single("file"), async (req: Request, res: Response) => {
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
      } else if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) {
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
          error: "Unsupported file type. Please upload a PDF, Word document, or text file." 
        });
      }

      res.json({ content, fileName: file.originalname });
    } catch (error) {
      console.error("Error uploading file:", error);
      res.status(500).json({ error: "Failed to process file" });
    }
  });

  // Course duplication
  app.post("/api/courses/:id/duplicate", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const duplicated = await storage.duplicateCourse(id);
      if (!duplicated) {
        return res.status(404).json({ error: "Course not found" });
      }
      res.status(201).json(duplicated);
    } catch (error) {
      console.error("Error duplicating course:", error);
      res.status(500).json({ error: "Failed to duplicate course" });
    }
  });

  // Saved Content Library API
  app.get("/api/library", async (req: Request, res: Response) => {
    try {
      const savedContent = await storage.getAllSavedContent();
      res.json(savedContent);
    } catch (error) {
      console.error("Error fetching library:", error);
      res.status(500).json({ error: "Failed to fetch library" });
    }
  });

  app.post("/api/library", async (req: Request, res: Response) => {
    try {
      const { title, toolType, content, description } = req.body;
      const saved = await storage.createSavedContent({
        title,
        toolType,
        content,
        description,
      });
      res.status(201).json(saved);
    } catch (error) {
      console.error("Error saving to library:", error);
      res.status(500).json({ error: "Failed to save to library" });
    }
  });

  app.delete("/api/library/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteSavedContent(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting from library:", error);
      res.status(500).json({ error: "Failed to delete from library" });
    }
  });

  // Word Document Export
  app.get("/api/content/:id/export-docx", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const content = await storage.getContent(id);
      
      if (!content) {
        return res.status(404).json({ error: "Content not found" });
      }

      const course = content.courseId ? await storage.getCourse(content.courseId) : null;
      
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
        })
      );

      if (course) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${course.courseName} (${course.courseNumber})`,
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
          })
        );
      }

      children.push(
        new Paragraph({
          children: [],
          border: {
            bottom: { color: "CCCCCC", style: BorderStyle.SINGLE, size: 6 },
          },
          spacing: { after: 400 },
        })
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
            })
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
            })
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
            })
          );
        } else if (line.match(/^[-*] /)) {
          const textContent = line.replace(/^[-*] /, "");
          const textRuns = parseInlineFormatting(textContent);
          children.push(
            new Paragraph({
              children: textRuns,
              bullet: { level: 0 },
              spacing: { after: 80 },
            })
          );
        } else if (line.match(/^\d+\. /)) {
          const textContent = line.replace(/^\d+\. /, "");
          const textRuns = parseInlineFormatting(textContent);
          children.push(
            new Paragraph({
              children: textRuns,
              numbering: { reference: "numbering", level: 0 },
              spacing: { after: 80 },
            })
          );
        } else if (line.startsWith("   - ") || line.startsWith("   * ")) {
          const textContent = line.replace(/^   [-*] /, "");
          const textRuns = parseInlineFormatting(textContent);
          children.push(
            new Paragraph({
              children: textRuns,
              bullet: { level: 1 },
              spacing: { after: 60 },
            })
          );
        } else {
          const textRuns = parseInlineFormatting(line);
          children.push(
            new Paragraph({
              children: textRuns,
              spacing: { after: 120 },
            })
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
        })
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
      
      const filename = `${content.toolName.replace(/\s+/g, "_")}_${course?.courseNumber || "export"}.docx`;
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error) {
      console.error("Error exporting to Word:", error);
      res.status(500).json({ error: "Failed to export to Word" });
    }
  });

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
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index), size: 22 }));
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
