.PHONY: clean clean-dry-run test lint build

# Remove all files/directories ignored by .gitignore
clean:
	git clean -fdX

# Run the test suite (node --test tests/**/*.test.js)
test:
	npm test

# Syntax-check every standalone script — there's no eslint config in this
# repo (see package.json), so this is a `node --check` sweep rather than a
# style lint. Catches the class of error CI would otherwise only find by
# actually running a hook/script (typo'd import, unbalanced brace, etc).
# Excludes workflows/*.js: those bodies run inside the Workflow tool's own
# async wrapper (top-level `return`/`await` is valid there), so `node
# --check` rejects them as standalone scripts even though they're correct —
# see workflows/README.md "Writing a custom workflow".
lint:
	@find hooks lib scripts -name '*.mjs' -o -name '*.js' | xargs -n1 node --check

# No-op: this repo is plain Node.js scripts run directly (no transpilation,
# bundling, or compiled artifact) — kept so CI can call `make build` like
# any other project without a special case.
build:
	@true