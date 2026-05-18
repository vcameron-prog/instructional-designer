# Threat Model

## Project Overview

This project is an AI-powered instructional design and document accessibility application for faculty. It uses a React/Vite frontend, an Express/TypeScript backend, PostgreSQL via Drizzle, Replit Auth for user sessions, and Anthropic APIs for content generation and document accessibility processing. Users can manage courses, generate reusable course materials, and upload PDF/DOCX/Google Docs content for conversion into accessible HTML/DOCX/PDF outputs.

Production assumptions for this threat model:
- The mockup sandbox is never deployed to production.
- In production, `NODE_ENV` is `production`.
- TLS between clients and the deployed app is handled by the platform.

## Assets

- **User accounts and sessions** -- Replit-authenticated user identities, session cookies, refresh tokens, and admin status. Compromise would allow impersonation or unauthorized access to user and admin features.
- **Faculty course data** -- course descriptions, syllabi, learning outcomes, assignment details, and saved templates. These may include unpublished teaching materials and institution-specific content.
- **Uploaded documents and extracted text** -- PDFs, DOCX files, Google Doc imports, extracted text, accessible HTML, compliance reports, and generated exports. These may contain copyrighted material, internal course content, or personal information.
- **Application secrets and integrations** -- database connection string, session secret, Replit OIDC settings, Anthropic API credentials, optional stats API key, and admin identity configuration.
- **Administrative analytics** -- user activity summaries, email addresses, names, and aggregate usage statistics exposed through admin-only reporting.

## Trust Boundaries

- **Browser to Express API** -- all client input is untrusted, including form fields, uploaded files, edited HTML, and URL parameters.
- **Authenticated user to other authenticated users** -- the app is multi-user. User-owned courses, generated content, saved templates, and conversions must be isolated server-side.
- **Anonymous user to anonymous user** -- some tools intentionally allow unauthenticated use. Anonymous records still require isolation; one anonymous visitor must not inherit access to another anonymous visitor's documents or results.
- **Express server to PostgreSQL** -- the backend has direct access to all application data. Authorization failures or unsafe bulk reads at this boundary expose cross-tenant data.
- **Express server to external services** -- the backend calls Anthropic and fetches Google Docs exports. User-controlled content crosses this boundary and must not expand into arbitrary outbound fetches or secret leakage.
- **Authenticated user to admin** -- admin analytics and operational visibility are a separate privilege tier enforced by `ADMIN_USER_IDS`.
- **Production vs dev-only code** -- tests, `attached_assets/`, local scripts, and Vite dev helpers should generally be excluded unless production reachability is demonstrated.

## Scan Anchors

- **Production entry points**: `server/index.ts`, `server/routes.ts`, `server/replit_integrations/auth/`, `client/src/main.tsx`.
- **Highest-risk code areas**: authentication/session setup, object ownership checks in `server/routes.ts` and `server/storage.ts`, document conversion flows, file upload handlers, HTML editing/export, and admin stats routes.
- **Public vs authenticated vs admin surfaces**:
  - Public/anonymous: `/api/generate-standalone`, `/api/upload-syllabus`, parts of `/api/conversions/*`, optionally `/api/stats/public`
  - Authenticated: `/api/courses/*`, `/api/content/*`, `/api/library`, `/api/conversions`
  - Admin: `/api/admin/check`, `/api/admin/stats`
- **Current confirmed May 2026 risk concentration**: anonymous conversion upload and processing endpoints remain the most important DoS review area. Their controls must be validated carefully because upload throttling currently happens after multipart buffering and processing timeouts do not guarantee cancellation of background work.
- **Current production auth assumption from code**: "authenticated user" currently means any Replit OIDC user. The code does not enforce a faculty-only allowlist or email-domain restriction.
- **Currently unreachable unless route registration changes**: `server/replit_integrations/chat/*` is present in the repo but is not wired into `registerRoutes()` or startup.
- **Usually dev-only**: `attached_assets/`, `server/vite.ts`, test files, build/test scripts.
- **Exported artifact scope**: downloaded HTML/DOCX/PDF files are treated as user-authored outputs once they leave the app. Do not report arbitrary active content inside exported artifacts as an in-app vulnerability unless the application later re-renders that artifact to other users or serves it inline under an application-controlled origin.

## Threat Categories

### Spoofing

The application relies on Replit OIDC and server-side sessions. Protected endpoints must require a valid session, refresh expired tokens safely, and never trust client-side state to prove identity or role. Admin status must be derived only from authenticated server-side claims matched against `ADMIN_USER_IDS`.

### Tampering

Users can edit generated content, upload files, and modify accessible HTML. The server must ensure that only the owner of a course, template, generated content item, or conversion can mutate it. Anonymous workflows still need tamper resistance so one visitor cannot overwrite or delete another visitor's records by guessing identifiers.

### Information Disclosure

This application stores high-value document text, accessible HTML, course materials, compliance reports, and some user profile data. API responses must be scoped to the correct owner, and logging must avoid copying full documents, generated content, or admin-only user details into operational logs. Google Docs imports and document export flows must not broaden access beyond the requesting user.

### Denial of Service

Several public or low-friction endpoints perform expensive work: file uploads, PDF/DOCX extraction, OCR, AI generation, and conversion/export steps. These routes need size limits, sensible rate limiting, and bounded processing so unauthenticated or low-privilege users cannot exhaust memory, CPU, model quotas, or Chromium/processing capacity.

### Elevation of Privilege

The primary elevation risk in this project is broken server-side authorization rather than classic code execution. Predictable object identifiers, shared tables without ownership fields, or routes that check authentication without checking ownership can let one user access another user's materials or let anonymous users act on other anonymous sessions. All ownership checks must be explicit and enforced on every read, write, download, restore, and delete path.
