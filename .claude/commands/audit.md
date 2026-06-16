---
description: Run a security + dependency audit before a release. Usage: /audit [version]
---

Run the `release-prep` workflow.

$ARGUMENTS

If a version was provided above, use `version=$ARGUMENTS`. If none was given, use `version=next`.

This will:
1. Run a full SEC-4 secret scan across the branch
2. Audit all package manifests for CVEs, unpinned versions, and license conflicts
3. Create a release PR with CHANGELOG entries (if version was specified)

Start by saying: "Starting release-prep audit$ARGUMENTS" then invoke the workflow.
