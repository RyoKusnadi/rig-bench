# OWASP Top 10 — Code-Level Audit Reference

Quick reference for security-reviewer. For each category: what to look for in code, not theory.

---

| # | Category | What to look for in code |
|---|---|---|
| **A01** | Broken Access Control | Resource accessed without ownership check; IDOR (user-supplied ID used directly); missing auth middleware on new routes; admin endpoints reachable by regular users |
| **A02** | Cryptographic Failures | Hardcoded secrets (→ SEC-4); MD5/SHA1/SHA256 for passwords (use bcrypt/argon2/scrypt); HTTP URLs for sensitive data; sensitive fields in logs or URLs; weak random (use `crypto/rand` not `math/rand`) |
| **A03** | Injection | SQL built by string concat (`"SELECT * FROM users WHERE id = " + id`); `exec()`/`eval()` with user input; `shell=True` in Python subprocess; Go `os/exec` with user-controlled args; template injection in server-side rendering |
| **A04** | Insecure Design | Business logic allows state manipulation (e.g. skip payment by manipulating step); missing rate limits on sensitive ops (login, password reset, OTP); unlimited retries on auth endpoints |
| **A05** | Security Misconfiguration | Debug mode reachable in production paths; overly permissive CORS (`Access-Control-Allow-Origin: *` on authenticated endpoints); verbose errors with stack traces to users; default credentials; unnecessary HTTP methods enabled |
| **A06** | Vulnerable Components | Flagged by dependency-auditor (CVEs in `go.mod`, `package.json`, `requirements.txt`); importing abandoned packages; pinned to a known-vulnerable version |
| **A07** | Auth & Session Failures | JWT not validated (missing signature check, missing `exp` check, accepting `alg: none`); session tokens in URLs; passwords stored without salt or with weak hash; missing `Secure`/`HttpOnly`/`SameSite` on cookies; session not invalidated on logout |
| **A08** | Integrity Failures | No integrity check on downloaded data; unsafe deserialization (`pickle.loads(user_data)`, `yaml.load()` without `Loader=yaml.SafeLoader`); unsigned software updates; no HMAC on critical state passed through client |
| **A09** | Logging Failures | Passwords, tokens, or PII written to logs; no structured logging with correlation IDs; logs queryable by unauthorized users; security events (login failures, privilege changes) not logged |
| **A10** | SSRF | User-controlled URL passed to `fetch()`, `http.Get()`, `requests.get()`, `curl` without allowlist; DNS rebinding risk; internal metadata endpoints reachable (`169.254.169.254`); redirects not validated |

---

## Skip rules

Skip a category entirely when:
- The diff contains no code touching that surface (e.g. a migration file can skip A07)
- **Always note the skip explicitly** — "A04 skipped: no business logic in this diff"

Never silently skip. Noting the skip is part of the audit.

---

## Severity mapping

| Finding | Severity |
|---|---|
| SQL injection, command injection, SSRF with internal access | Critical |
| JWT not validated, hardcoded secret, broken auth | Critical |
| Missing rate limit on login/OTP/password-reset | High |
| Sensitive data in logs | High |
| Missing `Secure`/`HttpOnly` on session cookie | High |
| Overly permissive CORS on auth endpoint | High |
| Verbose error with stack trace | Medium |
| Missing correlation IDs in logs | Low |
| MD5 for non-security hashing (checksums, caching) | Low |
