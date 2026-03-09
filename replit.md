# BSU Instructional Design Tool

## Overview

This is an AI-powered instructional design tool built for Bridgewater State University (BSU) faculty. The application helps educators create comprehensive, UDL-aligned (Universal Design for Learning) course materials including assignments, rubrics, syllabi, learning modules, and equitable grading policies. Faculty can input course information and use AI generation tools to produce ready-to-implement educational content.

## Recent Updates

### Quick Tools (Latest)
- **Standalone tool usage without course creation**: 6 tools available as "Quick Tools": Assignment Designer, Rubric Builder, Alignment Checker, AI-Resistant Assignment Designer, Accessibility Checker, AI-Powered Activity Designer
- **Optional context fields**: Subject/Department (text) and Course Level (dropdown) on the tool form for tailored output
- **Routes**: `/quick-tools` (selection page), `/quick-tools/:toolId` (tool form), `/quick-tools/result/:contentId` (result page)
- **API**: `POST /api/generate-standalone`, `GET /api/standalone-content`, `GET /api/standalone-content/:id`
- **Database**: `courseId` is nullable in `generatedContent` table; standalone content stored with `courseId = null`
- **Landing page**: "Quick Tools" card alongside "Start New Course"
- **Result page**: Hides "Connect to Course" button in standalone mode; export and refine still work

### ADA Title II / WCAG 2.1 AA Compliance
- **Skip Navigation**: "Skip to main content" link as first focusable element, visually hidden until focused
- **Dynamic Page Titles**: Every page sets a unique `document.title` via `usePageTitle` hook (WCAG 2.4.2)
- **ARIA Live Regions**: Loading states, copy-to-clipboard, and content approval toggle announce to screen readers
- **Keyboard Accessibility**: All interactive cards (course cards, tool cards) have `role="button"`, `tabIndex`, and `onKeyDown` handlers; action buttons visible on focus-within
- **Focus Management**: `FocusManager` component moves focus to `#main-content` on route changes
- **Form Error Accessibility**: `aria-required` on all required fields, focus-on-first-error on validation failure
- **Color Contrast**: Muted foreground darkened (40% → 35% lightness) for AA compliance
- **Landmark Structure**: Every page wrapped in `<main id="main-content" tabIndex={-1}>`; proper `<h1>` hierarchy
- **Icon Button Labels**: All icon-only buttons have `aria-label` attributes (back, duplicate, delete, etc.)
- **Approval Toggle**: Uses `aria-pressed` and `aria-live` for state change announcements

### AI-Powered Activity Designer & AI-Powered Student Activities Option
- **New AI-Powered Activity Designer (11th tool)**: Standalone tool for designing student activities that intentionally use AI as a learning tool
  - Activity types: AI Debate/Socratic Dialogue, AI-Assisted Drafting & Revision, AI as Research Assistant, AI Code Review, AI-Generated Content Analysis, AI Tutoring/Study Partner, AI Data Analysis, Custom
  - Configurable AI tool recommendation (Claude, ChatGPT, Any, Multiple for comparison)
  - Student AI experience level selection (Beginner, Intermediate, Advanced)
  - Critical thinking focus areas (accuracy evaluation, bias identification, human vs AI comparison, prompt engineering, ethics)
  - Activity guardrails (interaction logs, reflection, human revision, peer review, citation)
  - Generates 10-section output: overview, learning objectives, preparation, step-by-step instructions with sample AI prompts, critical thinking checkpoints, reflection/metacognition, submission requirements, grading considerations, ethical guidelines, instructor notes
  - Research-grounded: EDUCAUSE 2025, Mollick & Mollick 2023, Bowen & Watson 2024, UNESCO 2023
- **"AI-Powered Student Activities" checkbox added to Assignment Designer**:
  - Fifth option alongside UDL, Cultural Relevance, SEL, and Accessibility
  - When selected, adds AI interaction points, critical evaluation requirements, documentation expectations, metacognitive reflection, and Bloom's taxonomy integration to the assignment output
- **New "AI-Powered Pedagogy" section on Research & Theory page**:
  - EDUCAUSE article citation and related research
  - Links to Anthropic Skilljar, BSU AI Center, ISTE AI in Education

### Accessibility Checker Tool & Selective Framework Inclusion
- **Accessibility Checker Tool (10th tool)**: Analyzes course content for accessibility compliance
  - Evaluates content against WCAG 2.1 guidelines, Section 508 standards, cognitive accessibility principles
  - Configurable analysis areas (visual, cognitive, motor, auditory, language)
  - Student population considerations (screen reader users, neurodivergent learners, ESL students, etc.)
  - Neutral base context (no forced frameworks - focuses purely on accessibility analysis)
- **Selective Framework Inclusion for Assignment Designer**:
  - Faculty can choose which pedagogical frameworks to include via checkboxes:
    - UDL (Universal Design for Learning)
    - Cultural Relevance & Inclusivity
    - SEL (Social-Emotional Learning)
    - Accessibility Features
    - AI-Powered Student Activities
  - Only selected frameworks are included in the AI prompt (conditional inclusion)
  - Research-grounded: CAST UDL Guidelines, CASEL SEL Framework, Geneva Gay, Gloria Ladson-Billings, WCAG 2.1, EDUCAUSE AI Pedagogy

### User Authentication
- Implemented Replit Auth (OpenID Connect) for secure user authentication
- Each faculty member has private, isolated course data
- User profile display in header with avatar/name and logout button
- Login page for unauthenticated users with security messaging
- All API routes protected with `isAuthenticated` middleware
- Courses filtered by `userId` to ensure data isolation

### Connected Course Materials
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
- "Save as Template" feature on result pages for reusing content across any course

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
- **Content Template Library**: Save generated content as reusable templates across any course
- **Course Duplication**: Clone courses with progress dashboard
- **Sample Courses**: Marked with [SAMPLE] prefix for clarity
- **Word Document Export**: Professional .docx export with preserved formatting (headings, bullets, numbered lists, bold/italic text) for easy import into Blackboard Ultra
- **Research & Theory Page**: Dedicated page with academic citations for all seven pedagogical frameworks (UDL, Cultural Relevance, SEL, Grading for Equity, AI-Resistant Design, Accessibility, AI-Powered Pedagogy)

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