---
name: Shared vi.mock factories must lazy-import
description: How to share a vi.mock() factory function across multiple Vitest test files without hitting a hoisting TDZ error.
---

Vitest hoists every `vi.mock(...)` call above regular top-level `import` statements in the same file. If a mock factory callback references a function that was imported normally at the top of the file (e.g. `import { createXMock } from "./test-utils/x-mock"`), it throws `ReferenceError: Cannot access '__vi_import_N__' before initialization` — the import binding isn't live yet when the hoisted `vi.mock()` factory executes.

**Why:** ESM import hoisting semantics don't save you here because Vitest's transform hoists `vi.mock()` itself above the import line, not just above other statements.

**How to apply:** When building a reusable mock factory for use across multiple test files, do NOT import it statically. Instead, dynamically import it inside the (necessarily `async`) factory callback:

```ts
vi.mock("./some/module", async () => {
  const { createSomeMock } = await import("./test-utils/some-mock");
  return createSomeMock({ someOverride: vi.fn() });
});
```

This defers resolution until the factory actually runs (during module mocking), sidestepping the TDZ issue entirely. Used for the shared `createAccessibilityEngineMock()` factory in `server/test-utils/accessibility-engine-mock.ts`.
