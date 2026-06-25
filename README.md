# BSU Accessibility Tool

An AI-powered instructional design and document accessibility application for BSU faculty.

## What it does

Converts PDFs, Word documents, and Google Docs to WCAG 2.1 AA–compliant accessible HTML, with download options for HTML, DOCX, and tagged PDF. Also generates UDL-aligned course materials: assignments, rubrics, syllabi, learning modules, and AI activity designs.

- **Port**: 5000 (default)
- **Entry point**: `server/index.ts` (backend) + `client/src/` (frontend)

## Setup

### Prerequisites
- Node.js 20+
- PostgreSQL database (`DATABASE_URL` env var)
- Anthropic API key (`ANTHROPIC_API_KEY` / `AI_INTEGRATIONS_ANTHROPIC_API_KEY`)

### Install and run
```bash
npm install
npm run dev        # starts on port 5000
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | ✅ | Anthropic Claude API key |
| `SESSION_SECRET` | ✅ | Express session secret |
| `SUMMARY_EMAIL_FROM` | ✗ | Gmail address for daily summary emails |
| `SUMMARY_EMAIL_PASSWORD` | ✗ | Gmail app password for daily summary |
| `ADMIN_USER_IDS` | ✗ | Comma-separated Replit user IDs with admin access |

## Running Tests

```bash
# Run all tests
npx vitest run

# Type checking
npx tsc --noEmit
```
