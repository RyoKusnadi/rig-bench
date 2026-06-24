// Shared helpers for Claude Code hooks. Plain Node.js (no deps) so hooks run
// identically on macOS, Linux, and Windows — the reason this harness moved
// off Bash. Also centralizes
// structured logging, fail-open error handling, and the RIGBENCH_* env vars
// so every hook gets them uniformly instead of reimplementing them.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function readStdinJson() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

export function repoRoot(importMetaUrl) {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  // hooks/<file>.mjs -> repo root is one level up. (Call this from a file
  // directly under hooks/, not from hooks/lib/, or pass CLAUDE_PROJECT_DIR.)
  const hooksDir = dirname(fileURLToPath(importMetaUrl));
  return join(hooksDir, '..');
}

// ── RIGBENCH_* environment controls ─────────────────────────────────────

export function isHookDisabled(name) {
  const list = (process.env.RIGBENCH_DISABLED_HOOKS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(name);
}

const PROFILES = ['minimal', 'standard', 'strict'];
export function hookProfile() {
  const p = process.env.RIGBENCH_HOOK_PROFILE;
  return PROFILES.includes(p) ? p : 'standard';
}

// ── Structured logging + fail-open execution ──────────────────────────────

let _ctx = null;

function logEvent(decision, extra = {}) {
  if (!_ctx) return;
  try {
    const logFile = join(_ctx.root, '.claude', 'hooks.log');
    const duration_ms = Date.now() - _ctx.start;
    const entry = {
      timestamp: new Date().toISOString(),
      hook: _ctx.name,
      event: _ctx.event,
      tool: _ctx.tool || null,
      exit_code: decision === 'block' ? 2 : 0,
      duration_ms,
      decision,
      ...extra,
    };
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(logFile, `${JSON.stringify(entry)}\n`);

    // Rotate: keep only the last 1000 lines, same treatment as bash.log.
    const lines = readFileSync(logFile, 'utf8').split('\n');
    if (lines.length > 1100) {
      writeFileSync(logFile, lines.slice(-1000).join('\n'));
    }

    if (duration_ms > 500) {
      console.error(`[${_ctx.name}] slow hook: ${duration_ms}ms`);
    }
  } catch {
    // Logging must never be the reason a hook fails.
  }
}

/**
 * Wrap a hook's body so an unexpected exception fails open (exit 0, allowing
 * the tool call) instead of crashing in a way Claude Code might treat as a
 * hard error. Blocking is still a deliberate `block()` call inside `fn` —
 * this only catches bugs/unexpected failures in the hook itself.
 */
export function runHook(name, event, root, tool, fn) {
  _ctx = { name, event, root, tool, start: Date.now() };

  if (isHookDisabled(name)) {
    logEvent('skipped_disabled');
    process.exit(0);
  }

  try {
    fn();
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    logEvent('error', { error: message });
    console.error(JSON.stringify({ hook: name, error: message, action: 'allowing_with_warning' }));
    process.exit(0); // never let a hook bug block the agent
  }
}

export function block(message, command) {
  logEvent('block', { message });
  console.log(`BLOCKED: ${message}`);
  if (command) console.log(`Command was: ${command}`);
  process.exit(2);
}

export function allow() {
  logEvent('allow');
  process.exit(0);
}

export function complete(extra) {
  logEvent('completed', extra);
  process.exit(0);
}

// ── JSON-based permission decisions (PreToolUse `hookSpecificOutput`) ──────
// Distinct from block()/allow() above: those use the exit-code protocol
// (exit 2 = block, exit 0 = allow), which suppresses a tool call but can't
// skip the permission prompt for a tool that would otherwise ask. These
// three emit the structured `permissionDecision` JSON instead, letting a
// hook actively grant ("allow") or refuse ("deny") without a prompt, or
// abstain ("ask"/no output) and fall back to normal prompting/settings.

export function permissionAllow(event, reason) {
  logEvent('allow', { reason });
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: event, permissionDecision: 'allow', permissionDecisionReason: reason },
    })
  );
  process.exit(0);
}

export function permissionDeny(event, reason) {
  logEvent('deny', { reason });
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: reason },
    })
  );
  process.exit(0);
}

export function noDecision() {
  logEvent('no_decision');
  process.exit(0);
}

// ── Cross-process lock for read-modify-write state files ─────────────────
// Hooks are short-lived single-shot processes, not long-running servers, so
// a full lockfile library is overkill — an exclusive-create lockfile next to
// the target file (atomic on every OS Node supports) is enough to serialize
// concurrent sessions' increments to the same JSON file (e.g. read-budget's
// per-session counters). Spin-waits synchronously since hooks have no other
// event-loop work to yield to; gives up and proceeds unlocked after
// `timeoutMs` rather than hang a hook indefinitely (same fail-open posture
// as runHook's catch-all — a stale/abandoned lock must never permanently
// block a tool call).
export function withFileLock(filePath, fn, { timeoutMs = 2000, retryMs = 25 } = {}) {
  const lockPath = `${filePath}.lock`;
  mkdirSync(dirname(filePath), { recursive: true });

  let fd;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fd = openSync(lockPath, 'wx');
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() > deadline) break; // fail open — proceed without the lock
      const until = Date.now() + retryMs;
      while (Date.now() < until) {
        /* busy-wait: short-lived hook process, nothing else to do */
      }
    }
  }

  try {
    return fn();
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
        unlinkSync(lockPath);
      } catch {
        // another process may have already cleaned up — not fatal
      }
    }
  }
}

// ── Small TTL cache for slow/external lookups ─────────────────────────────
// Only used for things that genuinely don't change often (e.g. the repo's
// default branch name) — not a general-purpose cache.

export function cached(root, key, ttlMs, compute) {
  const cacheFile = join(root, '.claude', 'hook-cache', `${key}.json`);
  try {
    if (existsSync(cacheFile)) {
      const { value, cachedAt } = JSON.parse(readFileSync(cacheFile, 'utf8'));
      if (Date.now() - cachedAt < ttlMs) return value;
    }
  } catch {
    // corrupt/missing cache entry — fall through and recompute
  }

  const value = compute();
  try {
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify({ value, cachedAt: Date.now() }));
  } catch {
    // caching is an optimization, not a requirement — ignore write failures
  }
  return value;
}
