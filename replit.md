# BSU Instructional Design Tool

## Overview

This is an AI-powered instructional design tool built for Bridgewater State University (BSU) faculty. The application helps educators create comprehensive, UDL-aligned (Universal Design for Learning) course materials including assignments, rubrics, syllabi, learning modules, and equitable grading policies. Faculty can input course information and use AI generation tools to produce ready-to-implement educational content.

## Recent Updates

### Connected Course Materials (Latest)
- Faculty can mark generated content as "connected" to their course
- Connected content is available to inform other tools (e.g., an approved syllabus can inform assignment generation)
- Toggle button on result pages: "Connect to Course" / "Connected" with visual feedback
- Database tracks `isApproved` status for each piece of generated content
- API endpoint: `PATCH /api/content/:id/approval` to toggle connection status

### BSU Template Integration
- Syllabus generation now follows BSU's official TTC syllabus template structure
- AI Policy generation uses BSU's 4-level AI Policy Framework (adapted from Leon Furze's AI Assessment Scale v2)
- Course templates added for quick start (Lecture, Seminar, Lab, Online, Hybrid)
- UDL Tips component displays contextual guidance on tool forms
- "Save to Library" feature on result pages for reusing content across courses

### Inclusive Design Integration
- All generated content now includes three pedagogical frameworks:
  - **UDL (Universal Design for Learning)**: Multiple means of engagement, representation, action & expression
  - **Cultural Relevance & Inclusivity**: Diverse perspectives, student identity, inclusive language
  - **SEL (Social-Emotional Learning)**: Self-awareness, relationship skills, growth mindset
- Each tool output includes dedicated inclusive design sections with actionable guidance

### Key Features
- **Welcome Modal**: 6-step onboarding tour for first-time users
- **Course Templates**: Pre-fill common course configurations (8 types: Lecture, Seminar, Studio, Lab/Science, Independent Study, Capstone, Online, Hybrid)
- **Inclusive Design Tips**: Tabbed interface with three pedagogical frameworks:
  - UDL (Universal Design for Learning)
  - Cultural Relevance & Inclusivity
  - SEL (Social-Emotional Learning)
- **Content Library**: Save and reuse generated content across courses
- **Course Duplication**: Clone courses with progress dashboard
- **Sample Courses**: Marked with [SAMPLE] prefix for clarity
- **Word Document Export**: Professional .docx export with preserved formatting (headings, bullets, numbered lists, bold/italic text) for easy import into Blackboard Ultra
- **Research & Theory Page**: Dedicated page with academic citations for all four pedagogical frameworks

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack Query (React Query) for server state
- **Form Handling**: React Hook Form with Zod validation
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with BSU-themed color palette (crimson primary, black secondary, white) - color-blind friendly design with high contrast
- **Typography**: Atkinson Hyperlegible font (dyslexia-friendly) as primary, with Lexend as fallback
- **Build Tool**: Vite with custom plugins for Replit integration

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Design**: RESTful endpoints under `/api` prefix
- **AI Integration**: Anthropic Claude API for content generation
- **File Processing**: Multer for handling file uploads (syllabus documents)

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema Location**: `shared/schema.ts` contains all table definitions
- **Tables**: 
  - `users` - basic authentication
  - `courses` - course metadata and details
  - `generatedContent` - AI-generated materials
  - `contentVersions` - version history for generated content
  - `conversations` / `messages` - chat functionality

### Code Organization
- **`client/`**: React frontend application
- **`server/`**: Express backend with routes, storage layer, and integrations
- **`shared/`**: Shared TypeScript types and database schema
- **`server/replit_integrations/`**: Replit-specific AI utilities (batch processing, chat routes)

### Key Design Patterns
- Storage interface pattern (`IStorage`) abstracts database operations
- Centralized API client with `apiRequest` helper
- Form validation schemas shared between frontend and backend using Zod
- Component-based UI architecture with shadcn/ui primitives

## External Dependencies

### AI Services
- **Anthropic Claude API**: Primary AI provider for content generation
  - Configured via `AI_INTEGRATIONS_ANTHROPIC_API_KEY` and `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`
  - Models used: claude-sonnet-4-5, claude-opus-4-5, claude-haiku-4-5

### Database
- **PostgreSQL**: Primary data store
  - Connection via `DATABASE_URL` environment variable
  - Session storage with `connect-pg-simple`

### Third-Party Libraries
- **drizzle-orm**: Type-safe SQL query builder and ORM
- **drizzle-zod**: Schema validation integration
- **p-limit / p-retry**: Rate limiting and retry logic for AI API calls
- **date-fns**: Date manipulation utilities
- **lucide-react**: Icon library