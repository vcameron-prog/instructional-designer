# BSU Instructional Design Tool

## Overview

This AI-powered instructional design tool assists Bridgewater State University (BSU) faculty in creating comprehensive, UDL-aligned course materials. It enables educators to generate assignments, rubrics, syllabi, learning modules, and equitable grading policies using AI based on course information inputs. The platform aims to provide ready-to-implement educational content, supporting faculty in developing high-quality and accessible learning experiences. Key capabilities include a PDF accessibility converter, quick tools for standalone content generation, and features for ensuring ADA Title II / WCAG 2.1 AA compliance. The tool also supports inclusive design principles by integrating UDL, Cultural Relevance & Inclusivity, and SEL frameworks into its generated content, alongside options for designing AI-powered student activities.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack Query
- **Form Handling**: React Hook Form with Zod validation
- **UI Components**: shadcn/ui built on Radix UI
- **Styling**: Tailwind CSS with BSU-themed color palette (crimson primary, black secondary, white) and high contrast for accessibility.
- **Typography**: Atkinson Hyperlegible (dyslexia-friendly) as primary, Lexend as fallback.
- **Build Tool**: Vite

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM)
- **API Design**: RESTful endpoints (`/api` prefix)
- **AI Integration**: Anthropic Claude API for content generation.
- **File Processing**: Multer for file uploads.

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Defined in `shared/schema.ts`.
- **Key Tables**: `users`, `courses`, `generatedContent`, `contentVersions`, `conversations`, `messages`, `conversions` (for PDF accessibility).

### Code Organization
- **`client/`**: React frontend.
- **`server/`**: Express backend logic, storage, integrations.
- **`shared/`**: Shared TypeScript types and database schema.
- **`server/replit_integrations/`**: Replit-specific AI utilities.

### Design Patterns
- Abstracted database operations using an `IStorage` interface.
- Centralized API client (`apiRequest`).
- Shared Zod schemas for frontend/backend validation.
- Component-based UI with shadcn/ui.

### Feature Specifications
- **Authentication**: Replit Auth (OpenID Connect) for secure, isolated user data, with optional anonymous access for Quick Tools and PDF conversion.
- **Document Accessibility Converter**: Full pipeline from PDF, Word (.docx), or Google Docs URL import to WCAG 2.1 AA compliant HTML, including AI extraction, chunking, compliance checks, and download options (HTML, DOCX, tagged PDF). Supports PDF and DOCX file uploads with source type tracking. Google Docs import accepts a pasted URL (document must be publicly shared with "Anyone with the link"), downloads as DOCX via Google's export API, and processes through the same DOCX extraction pipeline (sourceType: "google-doc"). DOCX extraction uses mammoth + node-html-parser.
- **Quick Tools**: Standalone use of individual AI tools without full course creation, with optional context fields.
- **ADA/WCAG Compliance**: Implemented features like skip navigation, dynamic page titles, ARIA live regions, keyboard accessibility, focus management, form error accessibility, enhanced color contrast, proper landmark structure, and icon button labels.
- **AI-Powered Activity Designer**: Tool for designing student activities that intentionally leverage AI, offering various activity types and configurable recommendations.
- **Selective Framework Inclusion**: Faculty can choose specific pedagogical frameworks (UDL, Cultural Relevance, SEL, Accessibility, AI-Powered Student Activities) for content generation.
- **Connected Course Materials**: Generated content can be marked as "connected" to a course, informing other tools and tracked via an `isApproved` status.
- **BSU Template Integration**: Syllabus generation adheres to BSU's official template; AI Policy generation uses BSU's 4-level framework.
- **Inclusive Design**: All generated content incorporates UDL, Cultural Relevance & Inclusivity, and SEL frameworks.
- **Content Template Library**: Ability to save generated content as reusable templates.
- **Course Management**: Course duplication and pre-filled course templates (Lecture, Seminar, Lab, etc.).
- **Export**: Professional .docx export for easy integration with LMS (e.g., Blackboard Ultra).

## External Dependencies

### AI Services
- **Anthropic Claude API**: Used for AI content generation and accessibility auditing.
  - Models: `claude-sonnet-4-5`, `claude-opus-4-5`, `claude-haiku-4-5`.

### Database
- **PostgreSQL**: Primary database for all application data.

### Third-Party Libraries
- **drizzle-orm**: ORM for PostgreSQL.
- **drizzle-zod**: Zod integration for Drizzle.
- **p-limit / p-retry**: For rate limiting and retry logic on AI API calls.
- **date-fns**: Date utility library.
- **lucide-react**: Icon library.
- **puppeteer-core**: Used for generating accessible PDFs from HTML.