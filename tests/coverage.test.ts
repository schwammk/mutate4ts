import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectUnitsFromSource } from '../src/units.js';
import {
  parseLcov,
  mergeLcov,
  coveredUnits,
  unitKeys,
  coverageStale,
  isCovered,
  unitKey,
} from '../src/coverage.js';

const LCOV = [
  'TN:',
  'SF:src/pricing.ts',
  'FN:2,discount',
  'FNDA:5,discount',
  'FN:6,tier',
  'FNDA:0,tier',
  'end_of_record',
  'SF:src/other.ts',
  'FN:1,solo',
  'FNDA:1,solo',
  'end_of_record',
].join('\n');

describe('parseLcov', () => {
  it('joins FN and FNDA records', () => {
    const files = parseLcov(LCOV, 'cov.info');
    expect(files).toHaveLength(2);
    expect(files[0].file).toBe('src/pricing.ts');
    expect(files[0].functions).toEqual([
      { name: 'discount', line: 2, hits: 5 },
      { name: 'tier', line: 6, hits: 0 },
    ]);
  });

  it('throws with source name and record number on a malformed record', () => {
    expect(() => parseLcov('SF:a.ts\nGARBAGE:1\nend_of_record', 'cov/a.info')).toThrow(
      'malformed LCOV record in cov/a.info (record 1): "GARBAGE:1"',
    );
  });
});

describe('mergeLcov', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('merges multiple lcov files and reports missing ones', () => {
    dir = mkdtempSync(join(tmpdir(), 'm4t-cov-'));
    writeFileSync(join(dir, 'a.info'), LCOV);
    writeFileSync(join(dir, 'b.info'), 'SF:src/third.ts\nFN:1,third\nFNDA:2,third\nend_of_record');
    const { files, missing } = mergeLcov([join(dir, 'a.info'), join(dir, 'gone.info'), join(dir, 'b.info')]);
    expect(missing).toEqual([join(dir, 'gone.info')]);
    expect(files.map((f) => f.file)).toEqual(['src/other.ts', 'src/pricing.ts', 'src/third.ts']);
  });

  it('merges duplicate SF records keeping max hits per (name, line)', () => {
    dir = mkdtempSync(join(tmpdir(), 'm4t-cov-'));
    writeFileSync(join(dir, 'a.info'), LCOV);
    writeFileSync(
      join(dir, 'dup.info'),
      'SF:src/pricing.ts\nFN:2,discount\nFNDA:9,discount\nend_of_record',
    );
    const { files } = mergeLcov([join(dir, 'a.info'), join(dir, 'dup.info')]);
    const pricing = files.find((f) => f.file === 'src/pricing.ts')!;
    expect(pricing.functions.find((f) => f.name === 'discount')!.hits).toBe(9);
  });
});

describe('covered/stale logic', () => {
  const files = parseLcov(LCOV, 'cov.info');

  it('unitKey is a stable composite', () => {
    expect(unitKey('src/a.ts', 'f', 3)).toBe('src/a.ts|f|3');
  });

  it('coveredUnits contains only FNDA>0 entries', () => {
    const covered = coveredUnits(files);
    expect(covered.has(unitKey('src/pricing.ts', 'discount', 2))).toBe(true);
    expect(covered.has(unitKey('src/pricing.ts', 'tier', 6))).toBe(false);
    expect(covered.has(unitKey('src/other.ts', 'solo', 1))).toBe(true);
  });

  it('isCovered answers per function', () => {
    expect(isCovered('src/pricing.ts', 'discount', 2, files)).toBe(true);
    expect(isCovered('src/pricing.ts', 'tier', 6, files)).toBe(false);
    expect(isCovered('src/nope.ts', 'ghost', 1, files)).toBe(false);
  });

  it('coverageStale compares the FN key set with the current enumeration', () => {
    const units = collectUnitsFromSource('function discount(total) {\n  return total;\n}\n', 'src/pricing.ts');
    // lcov says discount@2, tier@6; units say discount@1 → mismatch → stale
    expect(coverageStale(files, units)).toBe(true);
    const matching = collectUnitsFromSource(
      [
        'function discount(total) {',
        '  return total;',
        '}',
        '',
        'function tier(count) {',
        '  return count;',
        '}',
      ].join('\n'),
      'src/pricing.ts',
    );
    // still stale: tier hits 0 is fine but src/other.ts|solo is in lcov yet not in units
    expect(coverageStale(files, matching)).toBe(true);
  });

  it('unitKeys built from units matches coveredUnits shape', () => {
    const units = collectUnitsFromSource(
      ['function solo() {', '  return 1;', '}'].join('\n'),
      'src/other.ts',
    );
    expect(unitKeys(units)).toEqual(new Set([unitKey('src/other.ts', 'solo', 1)]));
  });
});
