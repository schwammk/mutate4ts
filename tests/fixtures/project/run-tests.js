// Stub test runner for fixtures: evals the mutated pricing module and asserts behavior.
// A killed mutant makes one of these assertions fail -> exit 1 -> mutant classified KILLED.
// `export ` is stripped only for evaluation (the file is TS source; eval needs plain functions).
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const raw = fs.readFileSync(path.join(root, 'tests/fixtures/project/src/pricing.ts'), 'utf8');
eval(raw.replace(/^export /gm, ''));
const checks = [
  ['discount(150) === 10', () => discount(150) === 10],
  ['discount(100) === 0', () => discount(100) === 0],
  ['tier(5) === "bulk"', () => tier(5) === 'bulk'],
  ['tier(2) === "some"', () => tier(2) === 'some'],
  ['tier(1) === "none"', () => tier(1) === 'none'],
];
// clamp exists only in the full pricing variant (clean-pricing.ts omits it); the
// check is asserted only at the interior point (5, 0, 10), so both boundary
// mutants of clamp survive it.
if (typeof clamp === 'function') {
  checks.push(['clamp(5, 0, 10) === 5', () => clamp(5, 0, 10) === 5]);
}
for (const [name, check] of checks) {
  if (!check()) {
    console.error(`FAILED: ${name}`);
    process.exit(1);
  }
}
console.log('all checks passed');
