---
title: Git workflow conventions — branch safety, commits, draft PRs
---

## Overview

Used by `operator` at the start of every mode (branch safety) and during SHIP mode
(commits already exist by then; this covers the PR itself). The non-negotiable hard
rules (no force-push, no push to default branch, draft-only) stay inline in
`operator.md` since they're safety-critical — this file covers the conventions and
templates, not the constraints.

---

## Branch safety check

Run before writing a single line of code, in any mode:

```bash
DEFAULT=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}')
DEFAULT=${DEFAULT:-main}
CURRENT=$(git branch --show-current)
if [ "$CURRENT" = "$DEFAULT" ]; then
  echo "BLOCKED: Current branch is '$DEFAULT' (default). Create a feature branch first."
  echo "Suggested: git checkout -b feat/<task-name>"
  exit 1
fi
```

If blocked: stop, report the branch name, suggest a feature-branch name from the task
description, and return without any file mutations.

---

## Conventional Commits

Each commit subject must match: `<type>(<optional scope>): <imperative subject>`

Allowed types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `ci`, `build`, `revert`

**Good:**
```
feat(auth): add JWT expiry validation
fix(cache): prevent nil map panic on uninitialized store
refactor(llm): extract retry logic into separate function
```

**Bad (reject these):**
```
fixed stuff
WIP
updated files
Added feature
```

Rules: imperative mood ("Add", "Fix", not "Added"/"Fixes"), sentence case, no
trailing period, subject ≤72 characters, one logical concern per commit — don't mix
a bug fix with a refactor in the same commit.

---

## Pre-flight checklist (before pushing)

```bash
CURRENT=$(git branch --show-current)
DEFAULT=$(git remote show origin 2>/dev/null | grep "HEAD branch" | awk '{print $NF}')
DEFAULT=${DEFAULT:-main}
git log ${DEFAULT}..HEAD --oneline
git diff ${DEFAULT}...HEAD --stat
git status --short
git diff --check   # merge-conflict markers
```

- [ ] `CURRENT` is not `DEFAULT`
- [ ] No uncommitted changes (unless caller explicitly says to ignore them)
- [ ] No merge conflicts
- [ ] Every commit subject matches the Conventional Commits format above

If any item fails: report what's wrong and what's needed before the PR can be
created — don't work around it.

---

## Draft PR body template

```markdown
## What
<1–2 sentences: what changed and why>

## How
<key technical decisions — file-level if helpful>

## Testing
<what was tested; commands to verify>

## Checklist
- [ ] Tests pass
- [ ] No new lint errors
- [ ] No secrets or debug artifacts committed
- [ ] Diff stays in stated scope
```

Title format: `<type>(<scope>): <short imperative description>`, under 72 characters.
Add `Closes #<issue>` if an issue number was mentioned anywhere in the task.

---

## CHANGELOG entry (when applicable)

If the change is user-facing and `CHANGELOG.md` exists, append under `## [Unreleased]`
in [Keep a Changelog](https://keepachangelog.com) format:

```markdown
### Added / Changed / Fixed / Removed / Security
- <user-facing description, not a commit-message dump>
```

Map commit types to sections: `feat`→Added, `fix`→Fixed, `refactor`/`perf`→Changed
(only if user-facing), security fixes always go in `### Security` regardless of
commit type. Omit `docs`/`test`/`chore`/`ci` — internal, no user impact.

For a named release: rename `[Unreleased]` to `[<version>] - <date>`, add a fresh
empty `[Unreleased]` above it, and update the compare links at the bottom using
`git remote get-url origin`.
