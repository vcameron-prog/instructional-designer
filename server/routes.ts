import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCourseSchema, type Course } from "@shared/schema";
import Anthropic from "@anthropic-ai/sdk";
import multer from "multer";
import { z } from "zod";

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

  const baseContext = `You are an expert instructional designer creating materials for Bridgewater State University faculty. Create comprehensive, ready-to-implement content that incorporates Universal Design for Learning (UDL) principles.

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

Additional Context: ${course.additionalContext || "None provided"}${syllabusContext}`;

  const prompts: Record<string, string> = {
    assignment: `${baseContext}

Create a COMPLETE assignment that includes:
1. Clear title and overview
2. Detailed learning objectives
3. Comprehensive step-by-step instructions
4. UDL accommodations and alternatives
5. Submission requirements for Blackboard Ultra
6. Grading criteria overview
7. Resources and support materials
8. Timeline and milestones

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
7. UDL implementation strategies
8. Blackboard organization structure

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

Create an ENHANCED syllabus following BSU's template with:
1. Warm course welcome
2. Course information at-a-glance
3. Learning outcomes (course and module level)
4. Assignments with rubric connections
5. Grading policies
6. BSU institutional policies
7. Student success sections
8. Complete course schedule`,

    schedule: `${baseContext}

Create a COMPREHENSIVE course schedule with ACTUAL CALENDAR DATES:
1. Week-by-week breakdown with specific dates
2. Topics and learning objectives
3. Readings and materials
4. Assignments with due dates
5. Assessment schedule
6. Account for breaks and holidays

Course Dates: ${toolData.startDate} to ${toolData.endDate}
Format: ${toolData.courseFormat}
Duration: ${toolData.numberOfWeeks} weeks
Meeting Pattern: ${toolData.meetingPattern}
Meeting Days: ${toolData.meetingDays || "Not specified"}
Major Topics: ${toolData.majorTopics}
Assessments: ${toolData.assessments}
Additional Context: ${toolData.additionalContext || "None"}`,

    aipolicy: `${baseContext}

Create a COMPREHENSIVE AI USE POLICY for this course that is clear, fair, and pedagogically sound.

INSTRUCTOR'S STANCE: ${toolData.aiStance}

AI TOOLS TO ADDRESS:
${toolData.aiTools?.map((tool: string) => `- ${tool}`).join("\n") || "General AI tools"}

KEY ASSIGNMENTS:
${toolData.keyAssignments}

PRIMARY CONCERNS:
${toolData.concerns?.map((c: string) => `- ${c}`).join("\n") || "General concerns"}

ADDITIONAL CONTEXT: ${toolData.additionalContext || "None"}

Please create a policy that includes:
1. **Clear Policy Statement** - Overall stance in student-friendly language
2. **Rationale** - Why this policy exists (pedagogical reasoning)
3. **Assignment-Specific Guidelines** - A matrix or list showing what's allowed for each assignment type
4. **Permitted Uses** - Specific ways students CAN use AI (if any)
5. **Prohibited Uses** - What is NOT allowed
6. **Disclosure Requirements** - How students should cite/acknowledge AI use
7. **Consequences** - What happens if policy is violated
8. **Equity Statement** - Acknowledging access differences
9. **Resources** - Where students can get help instead of/in addition to AI
10. **FAQ Section** - Common questions students might have

Make the policy:
- Written in a supportive, educational tone (not punitive)
- Specific enough to be enforceable
- Flexible enough to adapt as AI evolves
- Aligned with academic integrity principles
- Ready to paste into a syllabus or Blackboard`,

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
1. **Alignment Matrix** - A clear table showing which assignments assess which outcomes
2. **Coverage Analysis** - Are all outcomes adequately assessed?
3. **Gap Identification** - Any outcomes not assessed or under-assessed
4. **Overlap Analysis** - Outcomes assessed multiple times (is this intentional/appropriate?)
5. **Bloom's Taxonomy Analysis** - What cognitive levels are assignments targeting?
6. **Recommendations** - Specific suggestions to improve alignment
7. **Strengths** - What's working well in the current design

Format the matrix clearly so it can be used for accreditation documentation or course improvement.`,
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

  return httpServer;
}
