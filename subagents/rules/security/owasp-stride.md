---
title: OWASP Top 10 and STRIDE threat-model checklists
---

## Overview

Used by `inspector` during Pass B of its quality review. The SEC-4 secret-detection
patterns and escalation report template are **not** here — they stay inline in
`inspector.md` because that check is mandatory and always-run on every invocation;
this file covers the broader security categories that are read conditionally during
the security pass.

---

## OWASP Top 10

| # | Category | What to look for |
|---|----------|-----------------|
| A01 | Broken Access Control | Resource access without ownership check; IDOR (ID param from user input); missing auth middleware on new routes |
| A02 | Cryptographic Failures | Hardcoded secrets; MD5/SHA1 for passwords; HTTP instead of HTTPS; sensitive data in logs/URLs |
| A03 | Injection | SQL built by string concat; `exec()`/`eval()` with user input; `shell=True`; template injection |
| A04 | Insecure Design | Business logic that allows state manipulation; missing rate limits on sensitive ops |
| A05 | Security Misconfiguration | Debug mode in production paths; overly permissive CORS (`*`); verbose error messages exposing stack traces |
| A06 | Vulnerable Components | Flagged by the dependency audit step |
| A07 | Auth & Session Failures | JWT not validated; session tokens in URLs; password hashes without salt; missing expiry |
| A08 | Integrity Failures | No integrity check on downloaded/deserialized data; unsafe `pickle`/`yaml.load` |
| A09 | Logging Failures | Sensitive data (tokens, passwords, PII) written to logs; no structured logging with correlation IDs |
| A10 | SSRF | User-controlled URLs passed to `fetch`/`http.Get`/`requests.get` without an allowlist |

Skip categories with no relevant surface area in the diff — but note the skip
explicitly in the "What I checked" section rather than silently omitting it.

---

## STRIDE

Only run this pass for diffs touching authentication, authorization, session
handling, APIs, or data storage. Skip and note if not applicable.

| Threat | Check |
|--------|-------|
| **S**poofing | Identity proven before resources accessed? JWT/session verified correctly? |
| **T**ampering | User input validated and parameterized? HMAC/signatures on critical data? |
| **R**epudiation | Audit logs with user ID + correlation ID? Logs tamper-resistant? |
| **I**nformation Disclosure | Errors redacted for users? No secrets in responses, headers, or logs? |
| **D**enial of Service | Rate limits on expensive ops? Pagination enforced? Unbounded allocations? |
| **E**levation of Privilege | Role checks verify ownership, not just membership? No privilege escalation path? |
