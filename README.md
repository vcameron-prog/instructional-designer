# BSU Accessibility Tool — Monorepo

This repository contains **two independent web applications** that share a single PostgreSQL database.

## Applications

### 1. Accessibility Converter (root — `npm run dev`)
Converts PDFs, Word documents, and Google Docs to WCAG 2.1 AA–compliant accessible HTML, with download options for HTML, DOCX, and tagged PDF.

- **Port**: 5000 (default)
- **Entry point**: `server/index.ts` (backend) + `client/src/` (frontend)
- **Default route**: `/` → document upload

### 2. Instructional Designer (`instructional-designer/` — `cd instructional-designer && npm run dev`)
AI-powered course-material generator for BSU faculty: assignments, rubrics, syllabi, learning modules, and UDL-aligned content.

- **Port**: 3001 (default)
- **Entry point**: `instructional-designer/server/index.ts` + `instructional-designer/client/src/`

## Cross-App Linking

Each app can link to the other via environment variables:

| Variable | Set in | Points to |
|---|---|---|
| `VITE_CONVERTER_APP_URL` | ID app (instructional-designer) | Accessibility Converter URL |

The Accessibility Converter does **not** link back to the ID app.

## Shared Database

Both apps connect to the same PostgreSQL database (`DATABASE_URL`). Table ownership:

| Tables | Owner |
|---|---|
| `conversions`, `ai_fix_retry_events`, `rate_limit_log`, `app_metrics` | Accessibility Converter |
| `courses`, `generated_content`, `content_versions`, `saved_content`, `saved_outcomes` | Instructional Designer |
| `users`, `sessions` | Shared (Replit Auth) |

## Setup

### Prerequisites
- Node.js 20+
- PostgreSQL database (`DATABASE_URL` env var)
- Anthropic API key (`ANTHROPIC_API_KEY` / `AI_INTEGRATIONS_ANTHROPIC_API_KEY`)

### Accessibility Converter (root)
```bash
npm install
npm run dev        # starts on port 5000
```

### Instructional Designer
```bash
cd instructional-designer
npm install
PORT=3001 npm run dev
```

## Environment Variables

### Both apps
| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | ✅ | Anthropic Claude API key |
| `SESSION_SECRET` | ✅ | Express session secret |

### Instructional Designer only
| Variable | Optional | Description |
|---|---|---|
| `VITE_CONVERTER_APP_URL` | ✗ | URL of the Accessibility Converter (for cross-app links) |
| `SUMMARY_EMAIL_FROM` | ✗ | Gmail address for daily summary emails |
| `SUMMARY_EMAIL_PASSWORD` | ✗ | Gmail app password for daily summary |
| `ADMIN_USER_IDS` | ✗ | Comma-separated Replit user IDs with admin access |

## Running Tests

```bash
# Accessibility Converter tests (root)
npx vitest run

# Type checking (root)
npx tsc --noEmit

# Instructional Designer type checking
cd instructional-designer && npx tsc --noEmit
```
