import ts from 'typescript';
import { Unit } from './units.js';

export const RULE_NAMES = [
  'arithmetic',
  'multiplication',
  'increment',
  'boundary-gt',
  'boundary-lt',
  'equality',
  'boolean',
  'negation',
  'numeric',
  'logical',
];

export interface MutationSite {
  id: string;
  rule: string;
  file: string;
  name: string;
  startLine: number;
  start: number;
  end: number;
  original: string;
  replacement: string;
}

const BINARY_TOKENS: Partial<Record<ts.SyntaxKind, { rule: string; replacement: string }>> = {
  [ts.SyntaxKind.PlusToken]: { rule: 'arithmetic', replacement: '-' },
  [ts.SyntaxKind.MinusToken]: { rule: 'arithmetic', replacement: '+' },
  [ts.SyntaxKind.AsteriskToken]: { rule: 'multiplication', replacement: '/' },
  [ts.SyntaxKind.GreaterThanToken]: { rule: 'boundary-gt', replacement: '>=' },
  [ts.SyntaxKind.GreaterThanEqualsToken]: { rule: 'boundary-gt', replacement: '>' },
  [ts.SyntaxKind.LessThanToken]: { rule: 'boundary-lt', replacement: '<=' },
  [ts.SyntaxKind.LessThanEqualsToken]: { rule: 'boundary-lt', replacement: '<' },
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: { rule: 'equality', replacement: '!==' },
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: { rule: 'equality', replacement: '===' },
  [ts.SyntaxKind.EqualsEqualsToken]: { rule: 'equality', replacement: '!=' },
  [ts.SyntaxKind.ExclamationEqualsToken]: { rule: 'equality', replacement: '==' },
  [ts.SyntaxKind.AmpersandAmpersandToken]: { rule: 'logical', replacement: '||' },
  [ts.SyntaxKind.BarBarToken]: { rule: 'logical', replacement: '&&' },
};

const UNARY_INCREMENTS: Partial<Record<ts.SyntaxKind, string>> = {
  [ts.SyntaxKind.PlusPlusToken]: '--',
  [ts.SyntaxKind.MinusMinusToken]: '++',
};

interface RawSite {
  rule: string;
  name: string;
  startLine: number;
  start: number;
  end: number;
  original: string;
  replacement: string;
}

export function collectSites(sourceText: string, file: string, units: Unit[]): MutationSite[] {
  const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const raw: RawSite[] = [];
  const unitRoots = new Set(units.map((u) => u.node));
  for (const unit of units) {
    const unitBody = (unit.node as { body?: ts.Node }).body ?? unit.node;
    const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
    const visit = (node: ts.Node) => {
      if (ts.isBinaryExpression(node)) {
        const op = node.operatorToken;
        const mapEntry = BINARY_TOKENS[op.kind];
        if (mapEntry) {
          raw.push({
            rule: mapEntry.rule,
            name: unit.name,
            startLine: lineOf(op.getStart(sf)),
            start: op.getStart(sf),
            end: op.getEnd(),
            original: sourceText.slice(op.getStart(sf), op.getEnd()),
            replacement: mapEntry.replacement,
          });
        }
      }
      if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
        const replacement = UNARY_INCREMENTS[node.operator];
        if (replacement) {
          const token = node.getChildren(sf).find((c) => c.kind === node.operator);
          if (token) {
            raw.push({
              rule: 'increment',
              name: unit.name,
              startLine: lineOf(token.getStart(sf)),
              start: token.getStart(sf),
              end: token.getEnd(),
              original: sourceText.slice(token.getStart(sf), token.getEnd()),
              replacement,
            });
          }
        }
      }
      if (ts.isIfStatement(node)) {
        const c = node.expression;
        raw.push({
          rule: 'negation',
          name: unit.name,
          startLine: lineOf(c.getStart(sf)),
          start: c.getStart(sf),
          end: c.getEnd(),
          original: sourceText.slice(c.getStart(sf), c.getEnd()),
          replacement: `!(${sourceText.slice(c.getStart(sf), c.getEnd())})`,
        });
      }
      if (ts.isNumericLiteral(node) && (node.text === '0' || node.text === '1')) {
        raw.push({
          rule: 'numeric',
          name: unit.name,
          startLine: lineOf(node.getStart(sf)),
          start: node.getStart(sf),
          end: node.getEnd(),
          original: node.text,
          replacement: node.text === '0' ? '1' : '0',
        });
      }
      if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
        raw.push({
          rule: 'boolean',
          name: unit.name,
          startLine: lineOf(node.getStart(sf)),
          start: node.getStart(sf),
          end: node.getEnd(),
          original: sourceText.slice(node.getStart(sf), node.getEnd()),
          replacement: node.kind === ts.SyntaxKind.TrueKeyword ? 'false' : 'true',
        });
      }
      for (const child of node.getChildren(sf)) {
        if (unitRoots.has(child)) continue;
        visit(child);
      }
    };
    visit(unitBody);
  }
  raw.sort((a, b) => a.start - b.start || a.end - b.end || a.rule.localeCompare(b.rule));
  const sites: MutationSite[] = [];
  let n = 0;
  for (const r of raw) {
    if (r.replacement === r.original) continue;
    n += 1;
    sites.push({ id: `M${String(n).padStart(3, '0')}`, file, ...r });
  }
  return sites;
}

export function applyMutation(sourceText: string, site: MutationSite): string {
  return sourceText.slice(0, site.start) + site.replacement + sourceText.slice(site.end);
}
