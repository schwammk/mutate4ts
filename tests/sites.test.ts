import { describe, it, expect } from 'vitest';
import { collectUnitsFromSource } from '../src/units.js';
import { collectSites, applyMutation } from '../src/sites.js';

function sites(code: string) {
  return collectSites(code, 'f.ts', collectUnitsFromSource(code, 'f.ts'));
}

describe('rule detection', () => {
  it('finds arithmetic sites in both directions', () => {
    const s = sites('function f(a, b) {\n  return a + b - 2;\n}\n');
    expect(s.map((x) => [x.rule, x.original, x.replacement])).toEqual([
      ['arithmetic', '+', '-'],
      ['arithmetic', '-', '+'],
    ]);
  });

  it('multiplication is one-directional (* → /)', () => {
    const s = sites('function f(a) {\n  return a * 2;\n}\n');
    expect(s.map((x) => [x.rule, x.replacement])).toEqual([['multiplication', '/']]);
  });

  it('finds increment sites prefix and postfix, both directions', () => {
    const s = sites('function f(a) {\n  a++;\n  --a;\n  return a;\n}\n');
    expect(s.map((x) => [x.rule, x.original, x.replacement])).toEqual([
      ['increment', '++', '--'],
      ['increment', '--', '++'],
    ]);
  });

  it('finds boundary sites for relational operators', () => {
    const s = sites('function f(a, b) {\n  if (a > b) return 1;\n  if (a >= b) return 2;\n  if (a < b) return 3;\n  if (a <= b) return 4;\n  return 0;\n}\n');
    expect(s.filter((x) => x.rule === 'boundary-gt').map((x) => [x.original, x.replacement])).toEqual([
      ['>', '>='],
      ['>=', '>'],
    ]);
    expect(s.filter((x) => x.rule === 'boundary-lt').map((x) => [x.original, x.replacement])).toEqual([
      ['<', '<='],
      ['<=', '<'],
    ]);
  });

  it('finds equality sites including loose variants', () => {
    const s = sites('function f(a, b) {\n  if (a === b) return 1;\n  if (a != b) return 2;\n  return 0;\n}\n');
    expect(s.filter((x) => x.rule === 'equality').map((x) => [x.original, x.replacement])).toEqual([
      ['===', '!=='],
      ['!=', '=='],
    ]);
  });

  it('finds boolean sites', () => {
    const s = sites('function f() {\n  return true === false;\n}\n');
    expect(s.filter((x) => x.rule === 'boolean').map((x) => [x.original, x.replacement])).toEqual([
      ['true', 'false'],
      ['false', 'true'],
    ]);
  });

  it('finds negation sites wrapping if-conditions', () => {
    const s = sites('function f(a) {\n  if (a > 0) {\n    return 1;\n  }\n  return 0;\n}\n');
    expect(s.filter((x) => x.rule === 'negation').map((x) => [x.original, x.replacement])).toEqual([
      ['a > 0', '!(a > 0)'],
    ]);
  });

  it('numeric applies to bare 0 and 1 literals only', () => {
    const s = sites('function f(a) {\n  return a + 0 - 1 + 10 + 0.5;\n}\n');
    expect(s.filter((x) => x.rule === 'numeric').map((x) => [x.original, x.replacement])).toEqual([
      ['0', '1'],
      ['1', '0'],
    ]);
  });

  it('finds logical sites both directions', () => {
    const s = sites('function f(a, b) {\n  return a && b || a;\n}\n');
    expect(s.filter((x) => x.rule === 'logical').map((x) => [x.original, x.replacement])).toEqual([
      ['&&', '||'],
      ['||', '&&'],
    ]);
  });

  it('suppresses no-op mutants (replacement identical to original)', () => {
    // `/` has no one-directional back-mutation, and `0.5`/`10` are not bare 0/1;
    // a forced no-op case: `!(x)` condition already produces `!(!(x))` — verify none are emitted.
    const s = sites('function f(a) {\n  return a * 1;\n}\n');
    expect(s.every((x) => x.replacement !== x.original)).toBe(true);
  });

  it('assigns M-ids per file in (start, end, rule) order and stamps unit ownership', () => {
    const code = 'function f(a) {\n  if (a > 0) {\n    return a;\n  }\n  return -a;\n}\n';
    const s = sites(code);
    expect(s.map((x) => x.id)).toEqual(['M001', 'M002', 'M003']);
    expect(s[0].rule).toBe('negation');
    expect(s[1].rule).toBe('boundary-gt');
    expect(s[2].rule).toBe('numeric');
    expect(s.every((x) => x.name === 'f' && x.file === 'f.ts' && x.startLine === 2)).toBe(true);
  });

  it('sites never cross function bodies', () => {
    const code = [
      'function outer(a) {',
      '  const inner = (b) => b + 1;',
      '  return inner(a);',
      '}',
    ].join('\n');
    const s = sites(code);
    const plus = s.find((x) => x.original === '+');
    expect(plus?.name).toBe('inner');
  });
});

describe('applyMutation', () => {
  it('replaces only the site span and preserves everything else byte-for-byte', () => {
    const code = 'function f(a) {\n  if (a > 0) {\n    return a;\n  }\n  return -a;\n}\n';
    const s = sites(code);
    const gt = s.find((x) => x.rule === 'boundary-gt')!;
    const mutated = applyMutation(code, gt);
    expect(mutated).toBe('function f(a) {\n  if (a >= 0) {\n    return a;\n  }\n  return -a;\n}\n');
  });

  it('negation replacement lengthens the text without corrupting later offsets (one mutant per application)', () => {
    const code = 'function f(a) {\n  if (a > 0) {\n    return a;\n  }\n  return -a;\n}\n';
    const s = sites(code);
    const neg = s.find((x) => x.rule === 'negation')!;
    expect(applyMutation(code, neg)).toBe('function f(a) {\n  if (!(a > 0)) {\n    return a;\n  }\n  return -a;\n}\n');
  });
});
