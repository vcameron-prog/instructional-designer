# Threat Model

## Project Overview

This project is an AI-powered instructional design and document accessibility application for faculty. It uses a React/Vite frontend, an Express/TypeScript backend, PostgreSQL via Drizzle, Replit Auth for user sessions, and Anthropic APIs for content generation and document accessibility processing. Users can manage courses, generate reusable course materials, and upload PDF/DOCX/Google Docs content for conversion into accessible HTML/DOCX/PDF outputs.

Production assumptions for this threat model:
- The mockup sandbox is never deployed to production.
- In production, `NODE_ENV` is `production`.
- TLS between clients and the deployed app is handled by the platform.
- The current deployment under review is **public** and autoscaled. Unauthenticated internet-origin traffic must be treated as production-reachable for any route that does not require auth.
- Autoscaling still matters for any public, authenticated, or admin traffic: process-local counters are instance-local unless backed by the database.

## Assets

- **User accounts and sessions** -- Replit-authenticated user identities, session cookies, refresh tokens, and admin status. Compromise would allow impersonation or unauthorized access to user and admin features.
- **Faculty course data** -- course descriptions, syllabi, learning outcomes, assignment details, and saved templates. These may include unpublished teaching materials and institution-specific content.
- **Uploaded documents and extracted text** -- PDFs, DOCX files, Google Doc imports, extracted text, accessible HTML, compliance reports, and generated exports. These may contain copyrighted material, internal course content, or personal information.
- **Application secrets and integrations** -- database connection string, session secret, Replit OIDC settings, Anthropic API credentials, optional stats API key, and admin identity configuration.
- **Administrative analytics** -- user activity summaries, email addresses, names, and aggregate usage statistics exposed through admin-only reporting.

## Trust Boundaries

- **Browser to Express API** -- all client input is untrusted, including form fields, uploaded files, edited HTML, and URL parameters.
- **Public internet to unauthenticated routes** -- the deployed app exposes public quick-tool and telemetry routes. Missing auth, rate limits, or abuse controls on those endpoints are production-relevant.
- **Authenticated user to other authenticated users** -- the app is multi-user. User-owned courses, generated content, saved templates, and conversions must be isolated server-side.
- **Anonymous user to anonymous user** -- some tools intentionally allow unauthenticated use. Anonymous records still require isolation; one anonymous visitor must not inherit access to another anonymous visitor's documents or results.
- **Express server to PostgreSQL** -- the backend has direct access to all application data. Authorization failures or unsafe bulk reads at this boundary expose cross-tenant data.
- **Express server to external services** -- the backend calls Anthropic and fetches Google Docs exports. User-controlled content crosses this boundary and must not expand into arbitrary outbound fetches or secret leakage.
- **Authenticated user to admin** -- admin analytics and operational visibility are a separate privilege tier enforced by `ADMIN_USER_IDS`.
- **Production vs dev-only code** -- tests, `attached_assets/`, local scripts, and Vite dev helpers should generally be excluded unless production reachability is demonstrated.

## Scan Anchors

- **Production entry points**: `server/index.ts`, `server/routes.ts`, `instructional-designer/server/routes.ts`, both apps' `server/replit_integrations/auth/`, `client/src/main.tsx`, and `instructional-designer/client/src/main.tsx`.
- **Highest-risk code areas**: authentication/session setup, object ownership checks in `server/routes.ts`, `server/storage.ts`, and `instructional-designer/server/storage.ts`, document conversion flows, file upload handlers, HTML editing/export, public Anthropic-backed quick tools, and the course-content approval route.
- **Primary production surfaces in the built root app**:
  - Anonymous or optionally authenticated conversion flows under `/api/conversions/*`
  - Authenticated profile endpoint `/api/auth/user`
  - Public quick-tool endpoints under `/api/tools/*`
  - Unauthenticated runtime metrics endpoint `/api/metrics`
  - BSU-restricted content approval route `/api/content/:id/approval`
- **Primary production surfaces in the proxied nested app**:
  - Public quick-tool endpoints under `/faculty/api/tools/*`
  - Quick-tool generation route `/faculty/api/generate-standalone`, which is intentionally anonymously reachable even though some faculty-app landing-page copy implies BSU-only access
  - Unauthenticated telemetry endpoints `/faculty/api/metrics` and `/faculty/api/stats/public`
  - BSU-authenticated course/content routes under `/faculty/api/courses/*` and `/faculty/api/content/*`
- **Current deployment-scope calibration (July 2026)**: because the deployed app is public, internet-reachable abuse of unauthenticated endpoints is in scope when request cost, outbound access, or resource consumption is materially attacker-controlled.
- **Current conversion-control calibration**:
  - `server/routes.ts` now applies shared DB-backed rate limits to upload/process/fix/export flows.
  - Google Docs/Sheets/Slides imports now use the same pre-buffer upload concurrency guard concept as direct uploads.
  - `/api/conversions/:id/process` now uses an atomic conditional status transition to avoid duplicate cross-instance processing starts.
  - Conversion ownership checks consistently use `conversionOwnerFilter(...)`, which scopes authenticated access by `userId` and anonymous access by server-side `visitorToken`.
  - PDF export in `server/lib/pdf-builder.ts` disables JavaScript and aborts non-`data:` network requests, so edited HTML should not be treated as a live server-side fetch primitive unless this file changes.
- **Current auth/session calibration**:
  - `server/replit_integrations/auth/replitAuth.ts` uses milliseconds for `cookie.maxAge` and correctly converts the PostgreSQL session-store TTL to seconds.
  - `sameSite: "lax"` and production `secure` cookies are in place.
  - `isBsuAuthenticated` enforces the `@bridgew.edu` email-domain gate for the BSU-only route(s) in the built app.
- **Current production auth assumption from code**: the conversion system allows anonymous usage and treats any valid Replit OIDC user as authenticated; only BSU-gated routes require a `@bridgew.edu` email suffix.
- **Current quick-tools calibration**:
  - Anonymous quick-tool access is an intended product capability for this project per `replit.md`; do not treat `/api/generate-standalone` or `/faculty/api/generate-standalone` as an auth bypass unless the product requirements change.
  - The relevant security question for those routes is abuse resistance (rate limiting, resource consumption, quota burn), not whether sign-in is required.
  - The root app's `/api/tools/url-scanner` currently has explicit remote-response size and body-stream timeout limits; the nested instructional-designer `/faculty/api/tools/url-scanner` must be reviewed separately because its fetch helper does not automatically inherit those controls.
- **Currently unreachable unless route registration changes**:
  - `server/replit_integrations/chat/*` is present in the repo but is not wired into `registerRoutes()` or startup.
- **Usually dev-only**: `attached_assets/`, `server/vite.ts`, test files, build/test scripts.
- **Exported artifact scope**: downloaded HTML/DOCX/PDF/XLSX files are treated as user-authored outputs once they leave the app. Do not report arbitrary active content inside exported artifacts as an in-app vulnerability unless the application later re-renders that artifact to other users or serves it inline under an application-controlled origin.

## Threat Categories

### Spoofing

The application relies on Replit OIDC and server-side sessions. Protected endpoints must require a valid session, refresh expired tokens safely, and never trust client-side state to prove identity or role. Admin status must be derived only from authenticated server-side claims matched against `ADMIN_USER_IDS`.

### Tampering

Users can edit generated content, upload files, and modify accessible HTML. The server must ensure that only the owner of a course, template, generated content item, or conversion can mutate it. Anonymous workflows still need tamper resistance so one visitor cannot overwrite or delete another visitor's records by guessing identifiers.

### Information Disclosure

This application stores high-value document text, accessible HTML, course materials, compliance reports, and some user profile data. API responses must be scoped to the correct owner, and logging must avoid copying full documents, generated content, or admin-only user details into operational logs. Google Docs imports and document export flows must not broaden access beyond the requesting user.

### Denial of Service

The application still contains expensive paths: file uploads, PDF/DOCX extraction, OCR, AI generation, and conversion/export steps. Because the deployment is public, unauthenticated abuse of those paths is reportable when a route lacks meaningful throttling or concurrency control and can burn Anthropic quota, tie up worker capacity, or otherwise degrade service for legitimate users.

### Elevation of Privilege

The primary elevation risk in this project is broken server-side authorization rather than classic code execution. Predictable object identifiers, shared tables without ownership fields, or routes that check authentication without checking ownership can let one user access another user's materials or let anonymous users act on other anonymous sessions. All ownership checks must be explicit and enforced on every read, write, download, restore, and delete path.
