# SEO Strategy

## In scope
- Root app public marketing and utility pages: `/`, `/accessibility`, `/pdf-accessibility`, `/pdf-accessibility/faq`, `/help`, `/accessibility-tools/*`
- Instructional Designer public routes under `/faculty`, especially `/faculty`, `/faculty/help`, `/faculty/research`, and `/faculty/accessibility-tools/*`
- Shared crawler-facing files such as `index.html`, `robots.txt`, sitemap/llms files, and public metadata assets

## Out of scope
- Authenticated dashboard and user-specific pages such as course editing, history, settings, library, result pages, and admin-only routes
- API endpoints except where they affect crawlability or public URL behavior

## Target audience
- Bridgewater State University faculty
- Visitors seeking the public accessibility converter
- Higher-education users evaluating BSU accessibility and instructional-design tools

## Primary keywords
- accessibility converter
- WCAG document remediation
- instructional design tool
- UDL course design
- BSU faculty accessibility tool

## Dismissed categories
- None yet

## Notes
- This codebase contains two separate public-facing Vite apps: the root app and the nested instructional-designer app mounted at `/faculty`.
- Scan judgments are based on source code, not the current deployment privacy setting.
