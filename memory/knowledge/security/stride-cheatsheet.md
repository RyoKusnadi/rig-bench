# STRIDE Threat Model — Code-Level Cheatsheet

Used by security-reviewer and code-reviewer (effort=high/maximum) on auth, API, and data-handling code.

---

| Threat | Full name | Code-level check |
|---|---|---|
| **S** | Spoofing | Is identity proven before resources are accessed? JWT/session verified with correct algorithm and `exp` claim? Client-supplied IDs not trusted without verification? |
| **T** | Tampering | User input validated at the boundary? Parameterized queries only — no string concat for SQL? HMAC or signatures on critical data passed through client? Immutable audit trail? |
| **R** | Repudiation | Structured audit logs with: user ID, action, resource ID, timestamp, correlation ID? Logs tamper-resistant (append-only, shipped off-host)? Security events (login, privilege change, delete) always logged? |
| **I** | Information Disclosure | Errors redacted for users (no stack traces, no internal paths)? No secrets/tokens in logs, headers, or URL params? No `dangerouslySetInnerHTML` with user input? No `eval()`/`exec()` with user input? |
| **D** | Denial of Service | Rate limits on expensive ops (login, search, file upload, LLM calls)? Pagination enforced — no unbounded `SELECT *`? File upload size limits? Regex with catastrophic backtracking potential (`(a+)+`, `(a|aa)+`)? |
| **E** | Elevation of Privilege | IDOR check: does resource access verify **ownership**, not just role membership? Can a regular user reach an admin endpoint by guessing a URL? Can a tenant access another tenant's data? |

---

## When to run STRIDE

Run the full STRIDE pass when the diff touches any of:
- Authentication or session management
- Authorization / permission checks
- API endpoints (new routes or changed handlers)
- Data storage or retrieval (DB queries, cache reads/writes)
- Token issuance or validation (JWT, OAuth, API keys)
- File upload or download
- Multi-tenant isolation logic

Skip STRIDE (and note the skip) when the diff is purely:
- Documentation changes
- Test changes with no new production logic
- UI styling or layout with no data flow

---

## Common STRIDE findings by stack

### Go / Gin
- **S**: `c.GetHeader("X-User-ID")` trusted without JWT validation
- **T**: `db.Exec("DELETE FROM users WHERE id = " + c.Param("id"))`
- **E**: `if user.Role == "admin"` without checking `user.TenantID == resource.TenantID`

### TypeScript / Next.js
- **I**: `res.json({ error: err.stack })` in production paths
- **D**: No rate limit on `/api/auth/login` route
- **T**: `dangerouslySetInnerHTML={{ __html: userProvidedContent }}`

### Python
- **T**: `yaml.load(data)` without `Loader=yaml.SafeLoader`
- **I**: `logger.info(f"Login attempt with password: {password}")`
- **S**: Session token stored in localStorage (accessible to XSS) instead of HttpOnly cookie
