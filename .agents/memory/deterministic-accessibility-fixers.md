---
name: Deterministic accessibility fixer route pattern
description: How fix-accessibility/preview-fix routes dispatch fixType to fixers, and why some fixers are dynamically imported
---

The `fix-accessibility` / `preview-fix` routes dispatch on a `fixType` string to a
set of deterministic (non-AI) fixers: markdown/HTML heading-skip and all-caps fixes
are small hand-written regex functions; HTML-table fixers (`fixHtmlTableCaption`,
`fixHtmlTableThead`, `editHtmlTableCaption`) live in `lib/table-fixers.ts`; ARIA
role fixers (`applyAriaTabRoleFix`, `applyAriaComboboxRoleFix`, `applyAriaGridRoleFix`)
live in `lib/accessibility-engine.ts` and are loaded via `await import(...)` *inside*
the switch case, not imported statically at module load.

**Why:** the test suites for this feature explicitly assert the ARIA fixers are
dynamically imported inside the route handler (only `getDeterministicFixerKeys()` is
expected to be a static/module-level import). Importing them statically still passes
functionally but diverges from the asserted contract in some test suites.

**How to apply:** when adding a new deterministic fixer, check whether the relevant
spec file expects a static or dynamic import before wiring it in — don't assume
consistency across fixers in the same dispatcher.
