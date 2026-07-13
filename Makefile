.PHONY: clean check verify status metrics worktrees serve

# Remove all files/directories ignored by .gitignore
clean:
	git clean -fdX

# Consistency checks: state-table sync + per-spec checks over spec.db (all projects)
check:
	scripts/check-state-sync.sh
	node --no-warnings scripts/spec-db.mjs check

# Full gates in one shot: consistency checks + the test suite
verify: check
	npm test

# Read-only web dashboard over spec.db (kanban, spec detail, metrics)
serve:
	@node --no-warnings scripts/spec-server.mjs

# Read-only lifecycle view: per-state counts + attention items (all projects)
status:
	@node --no-warnings scripts/spec-db.mjs status

# Read-only lifecycle metrics: attempts distribution, failure rate, dependency stats, cycle time
metrics:
	@node --no-warnings scripts/spec-db.mjs metrics

# List concurrent-dispatch worktrees, flag stale ones (read-only; suggested commands only)
worktrees:
	@scripts/worktree-status.sh
