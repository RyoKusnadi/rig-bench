---
title: developer agent
---

# Developer Agent

A language-agnostic **implementation** agent for features, bug fixes, and refactors.

## What it does

- Reads existing code to match project idioms before writing anything
- Follows a TDD Red-Green-Refactor cycle
- Runs real tests and shows actual output — never claims success without proof
- Commits with semantic, imperative-mood messages
- Scopes changes strictly to what was asked; never adds extras

## When to use it

- Implementing a new feature after planning is complete
- Fixing a bug (writes regression test first)
- Refactoring a module (verifies tests pass before and after)

## When NOT to use it

- Planning / design decisions → use the Plan agent or ask in the main thread
- Code review → use `code-reviewer`
- Security audits → use `security-reviewer`

## Languages supported

- TypeScript / Next.js (`npm test`, `tsc --noEmit`, `eslint`)
- Go (`go test -race ./...`, `go vet`, `golangci-lint`)
- Python (`pytest`, `mypy`, `flake8`)

## Language rule references

Shared style guides and convention docs live in the code-reviewer agent's rules folder (the developer agent cross-references them rather than duplicating):
- `../code-reviewer/rules/typescript.md`
- `../code-reviewer/rules/go.md`
