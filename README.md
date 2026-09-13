# mutate4ts

Mutation testing for TypeScript in the style of [unclebob/clj-mutate](https://github.com/unclebob/clj-mutate):
the tool applies one small mutation at a time to your production code and runs your tests.
A mutant that survives is a test gap. A source file is *certified* only after a run in which
every mutant was killed — recorded as an embedded manifest in the file itself.

## Install

npx github:schwammk/mutate4ts

## How it works

- Mutations (v1 rules): `+↔-`, `*→/`, `++↔--`, `>↔>=`, `<↔<=`, `===↔!==` (and loose forms), `true↔false`,
  `if (c) ↔ if (!(c))`, `0↔1`, `&&↔||`.
- Coverage-aware: with `--lcov`, mutants in untested functions are reported as NOT-COVERED
  (they also block certification).
- Differential: once a file carries a manifest, later runs mutate only functions that changed.
- One mutant at a time, in an isolated copy of the project; your test command's exit code
  is the only signal consumed.

## Options

| Option | Meaning | Default |
|---|---|---|
| `--source-root <dir>` | scan root | `src`, falls back to `.` |
| `--test-command <cmd>` | test command run per mutant (in an isolated copy) | Nx inference |
| `--mutate-all` | ignore existing manifests, mutate everything | off |
| `--mutation <M###>` | re-run specific mutant(s), repeatable; never certifies | — |
| `--lines <a-b>` | re-run mutants in a line range; never certifies | — |
| `--scan` | count mutation sites per file and rule; no tests run | off |
| `--lcov <path>` | LCOV file for coverage filtering; repeat to merge | none |
| `--timeout-factor <n>` | mutant timeout = n × baseline test time | 10 |
| `--format text|json` | report format | text |

## Exit codes

- `0` — every mutant killed, none uncovered
- `1` — configuration or tool error
- `2` — the baseline test run already fails
- `3` — survivors or uncovered mutations (the report names them)
- `4` — engine error

## Development

npm test
npm run build
npm run mutate-scan

MIT
