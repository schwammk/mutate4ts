# Upstream provenance

mutate4ts is a TypeScript port of unclebob's clj-mutate. This file records
which upstream revision the port was derived from and every subsequent
upstream review, so changes upstream can be evaluated and integrated
deliberately.

## Sources

| Name | Repo | Branch | Recorded revision (derived from) |
|------|------|--------|----------------------------------|
| upstream   | https://github.com/unclebob/clj-mutate  | master | `e798457eb9cb933c0428cbd77a9262cb94f8d9ba` |
| swarmforge | https://github.com/unclebob/swarm-forge | main   | `f4f5fbcae0de6f7dcc26e82400334227647cfdb2` |

- `upstream` is the mechanics source this port implements: one-mutation-at-a-
  time execution, the 10-rule v1 set (`+↔-`, `*→/`, `++↔--`, `>↔>=`, `<↔<=`,
  `===↔!==`, `true↔false`, condition negation, `0↔1`, `&&↔||`), the embedded
  footer manifest with differential mode as the default, LCOV-based
  skip-uncovered with staleness detection, isolated worker dirs, timeout
  factor ×10 with timeout→SURVIVED, narrow reruns that never certify, and the
  0–4 exit-code contract.
- `swarmforge` hosts the engineering.prompt constitution that references this
  toolset; watch it for contract changes (tool table rows, guardrails, e.g.
  mutation rules or workflow requirements).

The same revisions are recorded in machine-readable form in `.upstream`
(one `<name> <remote> <branch> <sha>` line each), which
`scripts/check-upstream.sh` reads.

## Checking for changes

    scripts/check-upstream.sh

An `unchanged` line per repo means nothing moved. When a repo has moved, the
script lists the new commits. Evaluate each change for relevance to this port,
then record the outcome:

1. Update the SHA in `.upstream` (and the table above) to the new revision.
2. Append a row to the decision log below.

## Decision log

| Date | Upstream | Revision | Changes observed | Verdict |
|------|----------|----------|------------------|---------|
| 2026-09-13 | upstream | `e798457…` | initial derivation: port implemented (10-rule v1 set; deeper clj-mutate machinery such as --update-manifest/multi-profile/--reuse-lcov deferred — see spec §9) | derived |
| 2026-09-13 | swarmforge | `f4f5fbc…` | engineering.prompt tool table read; TypeScript row absent (this port fills it) | derived |

