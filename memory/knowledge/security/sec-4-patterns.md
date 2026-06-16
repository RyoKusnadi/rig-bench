# SEC-4 Secret Detection Patterns

8 grep patterns for detecting hardcoded credentials. Used by `secret-scanner` (fast pass) and `security-reviewer` (full audit). Any match is an ESCALATION — never assess whether a match is real or a test fixture.

---

## The 8 patterns

Run against `git diff HEAD` for changed files, or against the full tree for a periodic audit.

```bash
# Pattern 1 — AWS access keys
grep -rn 'AKIA[0-9A-Z]\{16\}' .

# Pattern 2 — AWS secret keys
grep -rn 'aws.\{0,10\}secret.\{0,10\}["'"'"'][A-Za-z0-9/+=]\{40\}' .

# Pattern 3 — GitHub tokens (OAuth, PAT, server-to-server, user-to-server, refresh)
grep -rn 'gh[pousr]_[A-Za-z0-9_]\{36,\}' .

# Pattern 4 — GitHub fine-grained PATs
grep -rn 'github_pat_[A-Za-z0-9_]\{82\}' .

# Pattern 5 — Hardcoded JWTs
grep -rn 'eyJ[A-Za-z0-9_-]\{20,\}\.eyJ' .

# Pattern 6 — Private keys (RSA, EC, Ed25519, PEM)
grep -rn '\-\-\-\-\-BEGIN.*PRIVATE KEY\-\-\-\-\-' .

# Pattern 7 — Database connection URIs with credentials
grep -rn '\(mongodb+srv\|postgres\|mysql\|redis\)://[^:]*:[^@]*@' .

# Pattern 8 — Generic high-entropy secrets (api_key, secret_key, auth_token, etc.)
grep -rn '\(api[_-]\?key\|secret[_-]\?key\|auth[_-]\?token\|access[_-]\?token\|private[_-]\?key\)\s*[=:"'"'"']\s*[A-Za-z0-9_/+=\-]\{16,\}' .
```

---

## Escalation protocol

On any match:
1. **Stop all further analysis**
2. Truncate the matched value: first 6 characters + `...[REDACTED]`
3. Emit the escalation report (see format below)
4. Return `ESCALATION` verdict — never retry, never continue

**Never assess** whether a match is real or a test fixture. Always escalate. The human decides.

---

## Escalation report format

```
=== SECRET ESCALATION ===
Severity: CRITICAL
Triggered pattern: <pattern name>
File: <path>
Line: <number>
Secret type: AWS key | GitHub token | JWT | Private key | DB URI | Generic
Preview: <first 6 chars>...[REDACTED]
Context (±2 lines, value redacted):
  <line N-1>
  <line N>  ← [REDACTED]
  <line N+1>

Required actions:
- [ ] Rotate this credential IMMEDIATELY — assume it is compromised
- [ ] git log -S '<first 6 chars>' --all  (find all commits containing it)
- [ ] Remove from git history: git-filter-repo or BFG Repo Cleaner
- [ ] Invalidate all active sessions using this credential

Pipeline status: BLOCKED — do not proceed until credential is rotated
=== END ESCALATION ===
```

---

## Resume conditions

Pipeline resumes only after one of:
- `RESOLVED` — credential rotated, history cleaned, confirmed by human
- `ACCEPTED-RISK` — documented exception, accepted by human (e.g. test fixture in isolated test environment with no real access)
- `ABORT` — pipeline abandoned
