import { db } from "./db";
import { courses } from "@shared/schema";

export async function seedDatabase() {
  try {
    const existingCourses = await db.select().from(courses);

    if (existingCourses.length > 0) {
      console.log("Database already seeded, skipping...");
      return;
    }

    console.log("Seeding database with sample courses...");

    const sampleCourses = [
      {
        userId: "seed",
        courseName: "[SAMPLE] Introduction to Psychology",
        courseNumber: "PSYC 101",
        courseLevel: "Undergraduate - 100 level",
        credits: "3",
        semester: "Fall 2025",
        instructor: "Dr. Sarah Mitchell",
        department: "Psychology",
        courseDescription: "This introductory course provides an overview of the scientific study of behavior and mental processes. Students will explore topics including biological psychology, sensation and perception, learning, memory, development, personality, social psychology, and psychological disorders. Emphasis is placed on critical thinking and the application of psychological principles to everyday life.",
        learningOutcomes: "1. Describe major psychological theories and their historical context\n2. Apply scientific methods to understand human behavior\n3. Analyze psychological research and evaluate evidence\n4. Recognize the biological, social, and cultural factors that influence behavior\n5. Apply psychological principles to personal and professional contexts",
        prerequisites: "None",
        existingSyllabus: "",
        additionalContext: "This is a large lecture course with approximately 150 students. Weekly discussion sections are led by teaching assistants.",
      },
      {
        userId: "seed",
        courseName: "[SAMPLE] Technical Writing",
        courseNumber: "ENGL 202",
        courseLevel: "Undergraduate - 200 level",
        credits: "3",
        semester: "Spring 2026",
        instructor: "Prof. Michael Chen",
        department: "English",
        courseDescription: "This course focuses on developing clear, concise, and effective writing skills for professional and technical contexts. Students will learn to create various documents including reports, proposals, instructions, and professional correspondence. Emphasis is placed on audience analysis, document design, and collaborative writing practices.",
        learningOutcomes: "1. Write clear and effective technical documents for various audiences\n2. Design documents that enhance readability and usability\n3. Conduct research and integrate sources appropriately\n4. Collaborate effectively in team writing projects\n5. Edit and revise writing for clarity, accuracy, and professionalism",
        prerequisites: "ENGL 101 or equivalent",
        existingSyllabus: "",
        additionalContext: "Students will complete a major collaborative project working with a local organization to create professional documentation.",
      },
    ];

    for (const course of sampleCourses) {
      await db.insert(courses).values(course);
    }

    console.log(`Seeded ${sampleCourses.length} sample courses successfully!`);
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}
