---
name: Root app upload UI is dead code
description: Where document/image upload actually happens in each app
---
The root app's PDF upload tool was moved to a standalone converter app; /pdf-accessibility performs a window.location redirect there. client/src/components/UploadDropzone.tsx (and the instructional-designer copy) are not imported anywhere.
**Why:** A reviewer rejected a change made only to the dead dropzone component — it produces no user-facing effect.
**How to apply:** For any upload UX work, target the active flows (alt-text-generator.tsx, math-ocr.tsx, or the standalone converter), not UploadDropzone.tsx.
