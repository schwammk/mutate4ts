import { describe, it, expect } from 'vitest';
import { renderText, renderJson, MutantResult } from '../src/report.js';

const RESULTS: MutantResult[] = [
  { id: 'M001', rule: 'boundary-gt', file: 'src/pricing.ts', name: 'discount', startLine: 2, status: 'KILLED', seconds: 0.8 },
  { id: 'M002', rule: 'negation', file: 'src/pricing.ts', name: 'tier', startLine: 6, status: 'SURVIVED', seconds: 0.9 },
  { id: 'M003', rule: 'multiplication', file: 'src/pricing.ts', name: 'rounded', startLine: 10, status: 'NOT-COVERED', seconds: null },
];

describe('renderText', () => {
  it('orders SURVIVED, then NOT-COVERED, then KILLED, and prints a summary', () => {
    const lines = renderText(RESULTS).split('\n');
    expect(lines[0]).toContain('M002');
    expect(lines[0]).toContain('SURVIVED');
    expect(lines[1]).toContain('M003');
    expect(lines[1]).toContain('NOT-COVERED');
    expect(lines[2]).toContain('M001');
    expect(lines[2]).toContain('KILLED');
    expect(lines[3]).toContain('killed: 1  survived: 1  not-covered: 1');
  });

  it('renders a data row with id, rule, name, file:line, status, seconds', () => {
    const text = renderText(RESULTS);
    expect(text).toContain('M001  boundary-gt    discount    src/pricing.ts:2    KILLED    0.8s');
    expect(text).toContain('M003  multiplication    rounded    src/pricing.ts:10    NOT-COVERED    -');
  });

  it('returns an empty string for no results', () => {
    expect(renderText([])).toBe('');
  });
});

describe('renderJson', () => {
  it('returns a JSON array of result objects, empty array for no results', () => {
    const parsed = JSON.parse(renderJson(RESULTS)) as MutantResult[];
    expect(parsed).toEqual(RESULTS);
    expect(renderJson([])).toBe('[]\n');
  });
});
