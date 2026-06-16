# Code Smells Catalogue

Reference for refactorer and code-reviewer. Each smell: what it looks like, the indicator, and the refactoring approach.

---

| Smell | Indicator | Refactoring |
|---|---|---|
| **Long function** | >30 lines in one function | Extract Function — pull cohesive blocks into named helpers |
| **Long parameter list** | >4 parameters | Introduce Parameter Object — group related params into a struct/object |
| **Duplicate code** | Copy-paste blocks (identical or near-identical logic in 2+ places) | Extract Function / Extract Constant — one place to change |
| **Complex conditional** | Nested `if/else` >2 levels deep | Decompose Conditional / Guard Clauses — early returns flatten nesting |
| **Feature envy** | Function uses another object's data more than its own | Move Method — the function belongs on the other object |
| **Magic numbers** | Unexplained literals (`if tokens > 5000`, `time.Sleep(300)`) | Extract Constant — `const maxTokenBudget = 5000` |
| **Dead code** | Unreachable branches, unused exports, commented-out blocks | Delete — don't keep it "just in case"; git history preserves it |
| **Comment explaining WHAT** | `// increment counter` before `counter++` | Rename / Restructure — if the code needs a comment to explain what it does, rename it |
| **Inconsistent naming** | Mixed conventions in same file (`getUserById` + `fetch_user` + `UserGet`) | Rename — match the dominant convention in the codebase |
| **Tight coupling** | Constructor creates its own dependencies (`cache := NewCache()` inside handler) | Dependency Injection — pass the dependency in, don't create it inside |
| **God object** | One struct/class that knows and does everything | Extract Class — split by responsibility |
| **Primitive obsession** | Strings used for things that should be typed (`userID string` vs `type UserID string`) | Introduce Type — wrap the primitive |
| **Inappropriate intimacy** | Package A directly accesses package B's internals | Move or hide the internal — expose a proper interface |
| **Speculative generality** | Abstractions for requirements that don't exist yet | Delete — YAGNI; add the abstraction when the second use case arrives |

---

## When NOT to refactor

Stop immediately if any of these apply:

- **No tests exist** — cannot safely verify behavior is preserved; hand off to test-writer first
- **The code is about to be deleted** — refactoring deleted code is wasted effort
- **The public API would change** — that is a feature change, not a refactor; requires explicit approval
- **Tests are already failing** — fix the code or tests first; refactor on a clean baseline
- **Time pressure** — partial refactors are worse than none; either do it properly or don't

---

## Refactoring principles

1. **One smell at a time.** Never batch multiple refactorings into one commit.
2. **Run tests after each change.** If tests break, revert immediately — don't pile on more changes.
3. **Commit each refactoring separately.** `refactor: extract RateLimitExceeded into shared helper`
4. **External behavior must not change.** If callers would need to update, it's not a refactor.
5. **Metrics matter.** Measure before/after: function length, duplication count, cyclomatic complexity.
