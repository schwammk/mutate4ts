---
name: mutate4ts
description: "Mutation testing for TypeScript: applies one mutation at a time, runs the project's tests against each mutant, and reports killed vs survived vs not-covered. Survivors expose weak tests that line coverage alone hides. Use when mutation-testing TypeScript, strengthening a test suite, or certifying a file before it is considered done. Requires a working test command and preferably LCOV coverage data."
---

# mutate4ts — Mutation Testing for TypeScript

Applies one mutation at a time to function bodies, runs the project's tests
against each mutant, and classifies it: **KILLED** (tests failed with the
mutant in place — good), **SURVIVED** (tests still pass — a gap), or
**NOT-COVERED** (no coverage data — add tests first). Survivors reveal weak
assertions that line coverage cannot.

## Core discipline

- Work **one file at a time**: everything killed and nothing uncovered
  before moving to the next file. A fully-killing run writes an embedded
  manifest into the file; after that, the tool defaults to **differential
  mode** (only functions changed since certification get re-mutated).
- **Never hand-edit a manifest.** Only the tool writes manifests, and only
  after a run in which every mutant was killed and none uncovered.
- Narrow reruns (`--mutation M017`, `--lines 42-60`) report but **never**
  certify — a full or differential run is required.
- A timeout counts as SURVIVED (conservative). Exit 3 means survivors or
  uncovered mutants: add tests or fix code before moving on. Exit 2 means
  the baseline tests already fail: fix those first — mutation results mean
  nothing on a red suite.

## Usage

```bash
# Scan mutation-site counts without running anything (fast, no tests)
npx github:schwammk/mutate4ts --source-root src --scan

# Full run with explicit test command and coverage filter
npx github:schwammk/mutate4ts --source-root src \
  --test-command "npm test" --lcov coverage/lcov.info --mutate-all

# Nx monorepo: pass per-project LCOV paths (repeat --lcov to merge; globs
# are not expanded); without --test-command the tool infers it from
# nx.json + project.json
npx github:schwammk/mutate4ts --source-root packages \
  --lcov packages/a/coverage/lcov.info \
  --lcov packages/b/coverage/lcov.info --mutate-all

# Retest specific survivors only (never writes the manifest)
npx github:schwammk/mutate4ts --source-root src --mutation M009 --mutation M011 \
  --test-command "npm test"
```

### Output

Per-mutant rows, survivors first, then not-covered, then killed:

```
M009 boundary-lt   clamp    src/pricing.ts:19  SURVIVED  0.9s
M012 multiplication rounded  src/pricing.ts:29  NOT-COVERED  -
M001 negation      discount src/pricing.ts:2   KILLED  0.8s
killed: 9  survived: 2  not-covered: 1
```

`--format json` emits `{id, rule, file, name, line, status, seconds}` per
mutant.

## Exit codes

| Code | Meaning |
|------|---------|
| 0    | All targeted mutants killed (manifest written unless narrow) |
| 1    | Config/tool error (bad args, malformed manifest/LCOV, no test command) |
| 2    | Baseline test run failing — fix the tests first |
| 3    | Survivors or not-covered mutants — strengthen tests or fix code |
| 4    | Engine error (worker/mutation failure) |

## How It Works

1. Collects function-like units and assigns mutation-site IDs (M001…) per
   file in source order
2. Filters by the embedded manifest (differential by default; `--mutate-all`
   overrides) and by LCOV coverage (uncovered → NOT-COVERED, no test run;
   stale/missing coverage → warn and run unfiltered)
3. Runs the baseline tests once (must pass), then for each mutant: copies
   the project into an isolated worker directory, applies the single
   mutation, runs the test command with a timeout of `--timeout-factor`
   × baseline duration
4. Classifies each mutant, prints the report, and certifies fully-killed
   files by writing their manifest

## Rules (v1)

Arithmetic (`+↔-`), multiplication (`*→/`), increment (`++↔--`), boundary
(`>↔>=`, `<↔<=`), equality (`===↔!==` plus loose variants), boolean
(`true↔false`), condition negation (`if (c)` → `if (!(c))`), numeric
(`0↔1`), logical (`&&↔||`). Every survivor is a lead on a missing test —
write the test that distinguishes the mutant from the original, then
re-run.
