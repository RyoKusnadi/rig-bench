# Execute phase

Implement one or more specs from `specs/ready/` (and `specs/in_progress/`
if resuming). Dependency ordering matters here — running a spec whose
`depends_on` isn't actually satisfied yet produces code built against an
interface that doesn't exist.

## Step 1 — Discover specs

```bash
ls specs/ready/ 2>/dev/null | grep '\.md$'
```

If resuming, also list:

```bash
ls specs/in_progress/ 2>/dev/null | grep '\.md$'
```

Read the frontmatter of each file and extract `id`, `title`, `status`, and
`depends_on`.

Also collect the IDs of everything already in `specs/finished/` — these
count as pre-satisfied dependencies, not blockers:

```bash
ls specs/finished/ 2>/dev/null | grep '\.md$' | sed 's/-.*//' | head -100
```

## Step 2 — Determine which specs to run

- **No IDs given**: present the discovered specs and let the user choose —
  show each as `{id} — {title}` with its `depends_on`, plus an "all ready
  specs" option.
- **"all"**: select every discovered spec.
- **Specific IDs**: select only those. If an ID isn't found in the relevant
  folder, stop and report the missing ID rather than silently skipping it.

## Step 3 — Validate dependencies

For each selected spec, every entry in `depends_on` must be either already
in `specs/finished/`, or also present in the selected set for this run. If
not, stop and report clearly — proceeding anyway is how a spec ends up
implemented against an interface that isn't there yet:

```
ERROR: Spec 0003 depends on spec 0001, but 0001 is not finished and was not selected.
Either add 0001 to the selection or ensure it is in specs/finished/.
```

## Step 4 — Warn about file overlap (advisory)

For specs running concurrently (no dependency between them), check whether
their `Files/Interfaces Touched` sections overlap. If they do, warn but
don't block — this is a heads-up that a merge conflict is likely, not a
hard stop:

```
WARNING: Specs 0001 and 0002 both touch lib/foo.mjs — they will run concurrently.
If they edit conflicting lines, the second commit may conflict with the first.
Proceeding anyway.
```

## Step 5 — Execute each spec

Process specs with no unfinished `depends_on` first, then those whose
dependencies just completed. For each:

**5a. Move to in_progress**

```bash
git mv specs/ready/<filename> specs/in_progress/<filename>
```

(Skip this if resuming and the file is already in `specs/in_progress/`.)

**5b. Implement the spec**

Read the full spec content, then implement every acceptance criterion:
create a feature branch named after the spec ID and slug, make the
necessary changes, commit, and open a draft PR.

**5c. Move to waiting_verification**

```bash
git mv specs/in_progress/<filename> specs/waiting_verification/<filename>
```

Report: `Spec {id} — {title}: implementation complete, awaiting verification.`

## Quick reference

| Invocation | Behaviour |
|---|---|
| No IDs | Interactive: lists specs and asks which to run |
| `all` | Execute all specs in `specs/ready/` |
| `0001 0003` | Execute only those specs |
| `all` + resume | Include specs already in `specs/in_progress/` |
