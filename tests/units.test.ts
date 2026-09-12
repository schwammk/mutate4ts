import { describe, it, expect } from 'vitest';
import { collectUnits, collectUnitsFromSource, normalizeSlice, unitHash, RULE_VERSION } from '../src/units.js';

describe('collectUnitsFromSource', () => {
  it('collects a function declaration named by its identifier', () => {
    const units = collectUnitsFromSource('function add(a, b) {\n  return a + b;\n}\n', 'src/math.ts');
    expect(units).toHaveLength(1);
    expect(units[0].name).toBe('add');
    expect(units[0].file).toBe('src/math.ts');
    expect(units[0].startLine).toBe(1);
    expect(units[0].endLine).toBe(3);
  });

  it('names methods as Class.method and constructors as Class.constructor', () => {
    const code = [
      'class Greeter {',
      '  greet(name) {',
      '    return "hi " + name;',
      '  }',
      '  constructor(prefix) {',
      '    this.prefix = prefix;',
      '  }',
      '}',
    ].join('\n');
    const units = collectUnitsFromSource(code, 'src/greeter.ts');
    expect(units.map((u) => u.name)).toEqual(['Greeter.greet', 'Greeter.constructor']);
  });

  it('names identifier-bound arrows and function expressions by the bound identifier', () => {
    const code = [
      'const double = (n) => {',
      '  return n * 2;',
      '};',
      'const triple = function (n) {',
      '  return n * 3;',
      '};',
    ].join('\n');
    const units = collectUnitsFromSource(code, 'src/ops.ts');
    expect(units.map((u) => u.name)).toEqual(['double', 'triple']);
  });

  it('names get/set accessors as Class.getProp / Class.setProp and object-literal methods by key', () => {
    const code = [
      'const box = {',
      '  get size() {',
      '    return this._s;',
      '  },',
      '  set size(v) {',
      '    this._s = v;',
      '  },',
      '};',
      'class P {',
      '  get total() {',
      '    return 0;',
      '  }',
      '}',
    ].join('\n');
    const units = collectUnitsFromSource(code, 'src/misc.ts');
    expect(units.map((u) => u.name)).toEqual(['box.size', 'box.size', 'P.total']);
  });

  it('falls back to <anonymous:line> for unbound arrows and collects nested function-likes separately', () => {
    const code = [
      '(() => {',
      '  return () => {',
      '    return 1;',
      '  };',
      '})();',
    ].join('\n');
    const units = collectUnitsFromSource(code, 'src/anon.ts');
    expect(units.map((u) => u.name)).toEqual(['<anonymous:1>', '<anonymous:2>']);
  });
});

describe('normalizeSlice and unitHash', () => {
  it('strips comments and collapses whitespace so formatting edits do not change the hash', () => {
    const a = collectUnitsFromSource('function f(n) {\n  // a comment\n  return n + 1;\n}\n', 'f.ts');
    const b = collectUnitsFromSource('function f(n) {  return   n + 1; }\n', 'f.ts');
    expect(unitHash(a[0].node)).toBe(unitHash(b[0].node));
  });

  it('changes when the code semantics change', () => {
    const a = collectUnitsFromSource('function f(n) {\n  return n + 1;\n}\n', 'f.ts');
    const b = collectUnitsFromSource('function f(n) {\n  return n + 2;\n}\n', 'f.ts');
    expect(unitHash(a[0].node)).not.toBe(unitHash(b[0].node));
  });

  it('normalizeSlice removes comments and collapses whitespace', () => {
    const [unit] = collectUnitsFromSource('function f(n) {\n  /* block */\n  return n + 1;\n}\n', 'f.ts');
    expect(normalizeSlice(unit.node)).toBe('function f(n) { return n + 1; }');
  });
});

describe('collectUnits', () => {
  it('warns and skips files with syntax errors, returns sorted units', () => {
    const warnings: string[] = [];
    const units = collectUnits('tests/fixtures/units-tmp', (m) => warnings.push(m));
    expect(warnings.some((w) => w.includes('cannot parse, skipped: '))).toBe(true);
  });
});

describe('RULE_VERSION', () => {
  it('is 1', () => {
    expect(RULE_VERSION).toBe(1);
  });
});
