---
name: Test vi.mock exports define the real module contract
description: When implementing a route/handler to satisfy existing tests, treat each vi.mock() stub's export list as the authoritative interface — helpers must be placed in whichever module the mock targets.
---

When a test file does `vi.mock("./lib/some-module", () => ({ fnA: ..., fnB: ... }))`,
that mock **replaces the entire module** at import time — any real export not listed
in the mock's return object becomes `undefined`/missing when the module under test
imports it. This means the test's mock object literally defines the module's public
contract as far as the code under test is concerned.

**Why:** While implementing a route handler to satisfy pre-written tests, importing a
helper function from a lib module whose mock didn't include that helper caused a
"No export is defined on the mock" runtime error (500s), even though the real
(unmocked) module had the function. The tests could not be edited, so the production
code had to conform to the mock's shape, not the other way around.

**How to apply:** Before importing a helper into route/handler code that has existing
`vi.mock(...)` coverage in its test file, check exactly which named exports the mock
stubs out. Any function the handler needs that ISN'T in that mock's returned object
must either be added to the mock (only if you're allowed to edit the test) or defined
locally in the file being tested (e.g., directly in routes.ts) rather than imported
from the mocked module.
