#!/usr/bin/env node
// pre-bash-safety.mjs — PreToolUse hook enforcing CLAUDE.md's first non-negotiable:
// no destructive git operations without explicit confirmation.
//
// Protocol: receives the PreToolUse event as JSON on stdin. If the Bash command matches a
// destructive git pattern, emits a permissionDecision of "ask" (require confirmation —
// deliberately not "deny": the rule is about confirmation, and a human can legitimately
// approve a force-push). Otherwise exits 0 silently, leaving normal permission flow alone.
//
// Defense-in-depth, NOT a security boundary: it pattern-matches the raw command string and
// is trivially evadable by an adversarial caller (indirection, encoding, script files). Its
// job is to catch the honest-mistake case. It fails OPEN on malformed input so a protocol
// change can't brick every Bash call — the stderr note keeps that observable.
//
// No dependencies — Node built-ins only. Spec: specs/template/*/0004-pre-bash-safety-hook.md

const DESTRUCTIVE_PATTERNS = [
  {
    // git push --force / -f / --force-with-lease (lease is safer, still rewrites the remote)
    re: /\bgit\b[^|;&]*\bpush\b[^|;&]*(\s--force(-with-lease)?\b|\s-[a-zA-Z]*f[a-zA-Z]*\b)/,
    label: "force push",
  },
  {
    re: /\bgit\b[^|;&]*\breset\b[^|;&]*--hard\b/,
    label: "git reset --hard",
  },
  {
    // git branch -D <name>, or --delete --force in either order
    re: /\bgit\b[^|;&]*\bbranch\b[^|;&]*(\s-[a-zA-Z]*D[a-zA-Z]*\b|--delete[^|;&]*--force|--force[^|;&]*--delete)/,
    label: "force branch delete",
  },
  {
    // git clean with force+directories but NOT restricted to ignored files (X).
    // `git clean -fdX` (the Makefile's own clean) is allowed; `git clean -fd` asks.
    re: /\bgit\b[^|;&]*\bclean\b(?![^|;&]*[-a-zA-Z]*X)[^|;&]*\s-[a-zA-Z]*f[a-zA-Z]*\b[^|;&]*/,
    label: "git clean (force, not limited to ignored files)",
    extra: (cmd) => /\bclean\b[^|;&]*(\s-[a-zA-Z]*d|\s--force[^|;&]*-d|\s-d)/.test(cmd),
  },
  // ── extended ask-first patterns ──
  {
    // rm with recursive+force flags targeting anything outside the temp allowlist
    // (/tmp, /private/tmp, node_modules). Flags may be combined, separate, or long.
    // The extra() anchor requires rm at command position (start of a segment,
    // optionally after sudo) so `echo rm -rf x` and filenames don't trip it.
    re: /\brm\b/,
    label: "recursive force rm outside temp paths",
    extra: (cmd) => {
      const m = cmd.match(/(?:^|[|;&])\s*(?:sudo\s+)?rm((?:\s[^|;&]*)?)/);
      if (!m) return false;
      const args = (m[1] || "").trim().split(/\s+/).filter(Boolean);
      let recursive = false;
      let force = false;
      const targets = [];
      for (const a of args) {
        if (a === "--recursive") recursive = true;
        else if (a === "--force") force = true;
        else if (/^-[a-zA-Z]+$/.test(a)) {
          if (/[rR]/.test(a)) recursive = true;
          if (a.includes("f")) force = true;
        } else if (!a.startsWith("--")) targets.push(a);
      }
      if (!recursive || !force || targets.length === 0) return false;
      const allowed = (t) =>
        t === "/tmp" ||
        t.startsWith("/tmp/") ||
        t === "/private/tmp" ||
        t.startsWith("/private/tmp/") ||
        /(^|\/)node_modules\/?$/.test(t) ||
        t.includes("/node_modules/");
      return targets.some((t) => !allowed(t));
    },
  },
  {
    // git stash drop/clear — stashes have no branch ref; dropped means gone
    re: /\bgit\b[^|;&]*\bstash\b[^|;&]*\b(drop|clear)\b/,
    label: "git stash drop/clear",
  },
  {
    // remote branch deletion: git push --delete, or the empty-LHS refspec form
    // (`git push origin :branch`). `main:main` must not match — the colon needs
    // whitespace immediately before it to be a deletion.
    re: /\bgit\b[^|;&]*\bpush\b[^|;&]*(\s--delete\b|\s+:\S+)/,
    label: "remote branch deletion via push",
  },
  {
    // git checkout with a -- pathspec separator discards working-tree changes
    re: /\bgit\b[^|;&]*\bcheckout\b[^|;&]*\s--(\s|$)/,
    label: "git checkout -- (working-tree discard)",
  },
  {
    // git restore discards working-tree content unless it's the --staged-only
    // form (which merely unstages); --staged plus --worktree discards again.
    re: /\bgit\b[^|;&]*\brestore\b/,
    label: "git restore (working-tree discard)",
    extra: (cmd) => {
      const m = cmd.match(/\bgit\b[^|;&]*\brestore\b([^|;&]*)/);
      if (!m) return false;
      const args = m[1] || "";
      const staged = /\s--staged\b/.test(args);
      const worktree = /\s(--worktree|-W)\b/.test(args);
      return !staged || worktree;
    },
  },
];

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

const raw = await readStdin();

let command = "";
try {
  const event = JSON.parse(raw);
  command = String(event?.tool_input?.command ?? "");
} catch {
  // Fail open: a malformed event must not brick every Bash call. Keep it observable.
  process.stderr.write("pre-bash-safety: could not parse hook input; allowing (fail-open).\n");
  process.exit(0);
}

if (!command) process.exit(0);

for (const p of DESTRUCTIVE_PATTERNS) {
  if (p.re.test(command) && (!p.extra || p.extra(command))) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason:
            `Destructive git operation detected (${p.label}). CLAUDE.md non-negotiable: ` +
            `this needs explicit confirmation before running.`,
        },
      }) + "\n",
    );
    process.exit(0);
  }
}

process.exit(0);
