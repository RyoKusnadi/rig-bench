.PHONY: clean check verify status metrics worktrees serve

# Remove all files/directories ignored by .gitignore
clean:
	git clean -fdX

# Consistency checks: state-table sync + per-spec checks for the harness's own specs
check:
	scripts/check-state-sync.sh
	scripts/check-specs.sh template

# Full gates in one shot: consistency checks + the test suite
verify: check
	npm test

# Read-only web dashboard over spec.db (kanban, spec detail, metrics)
serve:
	@node --no-warnings scripts/spec-server.mjs

# Read-only lifecycle view: per-state counts + attention items
status:
	@scripts/spec-status.sh template

# Read-only lifecycle metrics: attempts distribution, failure rate, dependency stats, cycle time
metrics:
	@scripts/spec-metrics.sh template

# List concurrent-dispatch worktrees, flag stale ones (read-only; suggested commands only)
worktrees:
	@scripts/worktree-status.sh
