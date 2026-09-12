import { describe, it, expect } from 'vitest';
import { collectUnitsFromSource, unitHash } from '../src/units.js';
import {
  parseManifest,
  appendManifest,
  buildManifestBlock,
  testProfile,
  selectChanged,
} from '../src/manifest.js';

const CODE = 'function f(n) {\n  return n + 1;\n}\n';

function manifestFor(hash: string, mutations = 1, overrides = {}) {
  return {
    date: '2026-09-13T00:00:00Z',
    ruleVersion: 1,
    testProfile: 'abc',
    functions: [{ name: 'f', startLine: 1, endLine: 3, sha256: hash, mutations }],
    ...overrides,
  };
}

describe('round-trip', () => {
  it('appends a block and parses it back identically', () => {
    const m = manifestFor('deadbeef');
    const withManifest = appendManifest(CODE, m);
    expect(withManifest.startsWith(CODE)).toBe(true);
    expect(withManifest).toContain('mutate4ts-manifest v1');
    expect(parseManifest(withManifest)).toEqual(m);
  });

  it('returns null for a file without a manifest', () => {
    expect(parseManifest(CODE)).toBeNull();
  });

  it('appends exactly one manifest even when the source already ends with a newline', () => {
    const withManifest = appendManifest(CODE, manifestFor('deadbeef'));
    expect(withManifest.match(/mutate4ts-manifest v1/g)).toHaveLength(1);
  });

  it('buildManifestBlock renders the documented field order', () => {
    const block = buildManifestBlock(manifestFor('deadbeef', 3));
    expect(block).toContain(' * date: 2026-09-13T00:00:00Z');
    expect(block).toContain(' * rule-version: 1');
    expect(block).toContain(' * test-profile: abc');
    expect(block).toContain('"name":"f"');
    expect(block).toContain('"mutations":3');
  });
});

describe('fingerprints', () => {
  it('testProfile is a sha256 hex of the command', () => {
    expect(testProfile('npm test')).toMatch(/^[0-9a-f]{64}$/);
    expect(testProfile('npm test')).toBe(testProfile('npm test'));
    expect(testProfile('npm test')).not.toBe(testProfile('npm run test'));
  });
});

describe('selectChanged (differential)', () => {
  it('returns all units when there is no manifest', () => {
    const units = collectUnitsFromSource(CODE, 'f.ts');
    expect(selectChanged(units, null, 'abc')).toEqual(units);
  });

  it('skips units whose hash matches the manifest', () => {
    const units = collectUnitsFromSource(CODE, 'f.ts');
    const m = manifestFor(unitHash(units[0].node));
    expect(selectChanged(units, m, 'abc')).toHaveLength(0);
  });

  it('re-selects units whose hash changed', () => {
    const units = collectUnitsFromSource(CODE, 'f.ts');
    const m = manifestFor('deadbeef');
    expect(selectChanged(units, m, 'abc')).toEqual(units);
  });

  it('re-selects everything when ruleVersion differs', () => {
    const units = collectUnitsFromSource(CODE, 'f.ts');
    const m = manifestFor(unitHash(units[0].node), 1, { ruleVersion: 2 });
    expect(selectChanged(units, m, 'abc')).toEqual(units);
  });

  it('re-selects everything when the test profile differs', () => {
    const units = collectUnitsFromSource(CODE, 'f.ts');
    const m = manifestFor(unitHash(units[0].node), 1, { testProfile: 'other' });
    expect(selectChanged(units, m, 'abc')).toEqual(units);
  });
});
