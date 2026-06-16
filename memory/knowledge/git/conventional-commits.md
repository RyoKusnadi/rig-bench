# Conventional Commits

Reference for git-assistant and changelog-writer. Format, types, scopes, and examples.

---

## Format

```
<type>(<optional scope>): <imperative subject>

<optional body — explain WHY, not WHAT>

<optional footer — breaking changes, closes #issue>
```

- Subject line ≤ 72 characters
- Imperative mood: "Add", "Fix", "Refactor" — not "Added", "Fixed", "Refactoring"
- No trailing period on subject line
- Sentence case (not ALL CAPS, not all lowercase)

---

## Allowed types

| Type | When to use | Changelog section |
|---|---|---|
| `feat` | New user-facing feature | Added |
| `fix` | Bug fix | Fixed |
| `refactor` | Code restructure with no behavior change | Changed (if user-facing) / omit |
| `perf` | Performance improvement | Changed |
| `test` | Adding or fixing tests | omit |
| `docs` | Documentation only | omit |
| `chore` | Maintenance (deps, config, tooling) | omit |
| `ci` | CI/CD pipeline changes | omit |
| `build` | Build system changes | omit |
| `revert` | Reverts a prior commit | match the reverted type |

---

## Breaking changes

Add `!` after type/scope and a `BREAKING CHANGE:` footer:

```
feat(api)!: remove deprecated /v1/users endpoint

BREAKING CHANGE: The /v1/users endpoint has been removed. Use /v2/users instead.
Closes #88
```

---

## Scopes (examples per project)

### tier1-support-ai
`handler`, `cache`, `llm`, `reliability`, `config`, `ratelimit`, `budget`

### my-profile
`hero`, `nav`, `blog`, `github`, `seo`, `layout`

### mcp-go-local-server
`tools`, `config`, `core`, `agent`, `server`

Scope is optional. Use it when the change is clearly within one subsystem.

---

## Good examples

```
feat(cache): add per-tenant TTL configuration
fix(llm): prevent confidence scorer returning negative on empty response
refactor(handler): extract shared error response helper
perf(cache): use sync.Map for concurrent tenant cache access
docs(readme): update request pipeline diagram
chore(deps): upgrade gin to v1.10.1
test(ratelimit): add burst boundary test cases
ci: add govulncheck to pre-merge pipeline
feat(api)!: require tenant-id header on all endpoints
```

## Bad examples (reject these)

```
fixed stuff                      ← no type, past tense
WIP                              ← not a commit message
Updated files                    ← vague, past tense
FEAT: ADD CACHE                  ← all caps
fix: fixed the bug that broke it ← past tense, circular description
```

---

## Validation regex

```bash
# Check all commits on current branch against main
git log main..HEAD --format="%H %s" | while read hash subject; do
  if ! echo "$subject" | grep -qE "^(feat|fix|refactor|perf|test|docs|chore|ci|build|revert)(\([a-z0-9/-]+\))?!?: .+"; then
    echo "FAIL: $hash — $subject"
  fi
done
```
