# PR Body Template

Used by git-assistant when creating pull requests. Always created as **draft** first.

---

## Standard template

```markdown
## What
<1–2 sentences: what changed and why>

## How
<key technical decisions — module/file level if helpful>

## Testing
<what was tested; exact commands to verify>

## Checklist
- [ ] Tests pass
- [ ] No new lint errors
- [ ] No secrets or debug artifacts committed
- [ ] Diff stays in stated scope
- [ ] CHANGELOG.md updated (if user-facing change)

Closes #<issue number if applicable>
```

---

## Release PR template

```markdown
## Release v<version>

### What's in this release
<summary of major changes from CHANGELOG.md [Unreleased] section>

### Dependency audit
<paste summary from dependency-auditor: N CVEs checked, status>

### Pre-release checklist
- [ ] CHANGELOG.md updated — [Unreleased] → [version]
- [ ] All tests pass on main
- [ ] No open Critical findings from code-reviewer
- [ ] Dependency audit: no Critical CVEs
- [ ] Secret scan: CLEAN
- [ ] Version tag ready: `git tag v<version>`
```

---

## Size guidance

| PR size | Lines changed | Expectation |
|---|---|---|
| Small | < 100 | Single focused change, easy to review in one pass |
| Medium | 100–500 | Feature or bug fix with tests; split into logical commits |
| Large | 500–1000 | Must have a clear structure; consider splitting |
| Too large | > 1000 | Always split — reviewer fatigue causes missed bugs |

---

## What git-assistant checks before creating the PR

1. Not on the default branch
2. No uncommitted changes
3. No merge conflicts (`git diff --check`)
4. All commits follow Conventional Commits format
5. No `--force` or `--force-with-lease` needed
