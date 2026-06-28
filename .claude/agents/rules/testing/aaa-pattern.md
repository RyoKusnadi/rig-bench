---
title: Test structure — AAA pattern, coverage targets, mocking discipline
---

## Overview

Used by `operator` during BUILD mode's test-mapping step. Tests that pass trivially
without exercising real behavior are worthless — the goal is tests that catch real
bugs, not tests that satisfy a coverage number.

---

## Map the code paths first

Before writing a single test, trace every path through the code under test:

- **Happy path** — normal input, expected output
- **Error paths** — invalid inputs, missing fields, type mismatches
- **Exception handlers** — every `try/catch`, `recover`, `defer+recover`, `except` block
- **Boundary conditions** — zero, one, N-1, N, N+1, max values; empty collections; nil/null
- **Concurrency hazards** — if the code uses goroutines, channels, locks, or shared state

---

## AAA structure

Structure every test as **Arrange → Act → Assert**:

```
// Arrange: set up inputs, mocks, stubs, fixtures
// Act: invoke the code under test (one call per test)
// Assert: verify the outcome — one logical assertion per test
```

**Naming convention** (match existing project style if one exists):
- Go: `TestFunctionName_Condition_ExpectedBehavior`
- TypeScript/Jest: `"should <behavior> when <condition>"`
- Python: `test_<function>_<condition>_<expectation>`

One test per code path — don't combine multiple edge cases into one test, it makes
failures ambiguous.

---

## Coverage targets

| Layer | Target |
|---|---|
| Business logic / pure functions | 95% |
| Application layer (handlers, controllers) | 85% |
| Infrastructure (DB, HTTP clients, caches) | 80% |

Adjust down only if the codebase has established lower targets already — don't
invent a new bar.

---

## Real over mocks

Use real implementations wherever possible. Only mock at true boundaries (network,
filesystem, third-party APIs, time). In-memory structs, pure functions, and
synchronous code don't need mocks. Test behavior, not implementation details.

---

## Red-green verification

After writing a test, run it to confirm it exercises real code — and fails before
the fix/feature exists:

```bash
go test -race -run TestFunctionName ./...
npm test -- --testPathPattern="<test file>" --verbose
pytest tests/path/test_file.py -v
```

If a test passes before the implementation exists, the test isn't testing what you
think — re-examine the assertion. A green test before a fix should never happen.

Never write a test that can only pass if the implementation is buggy — if a test
matches a known bug, comment `// Regression: <description>` and flag it explicitly
rather than silently encoding the bug as expected behavior.
