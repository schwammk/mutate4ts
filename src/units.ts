import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { listSourceFiles } from './walk.js';

export const RULE_VERSION = 1;

const FUNCTION_LIKE = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);

export interface Unit {
  file: string;
  name: string;
  startLine: number;
  endLine: number;
  node: ts.Node;
}

const NAME_BOUNDING_PARENTS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.PropertyAssignment,
]);

function ownerNameOf(owner: ts.Node): string {
  if (ts.isClassDeclaration(owner) || ts.isClassExpression(owner)) {
    return owner.name ? owner.name.text : '<top>';
  }
  if (ts.isObjectLiteralExpression(owner) && NAME_BOUNDING_PARENTS.has(owner.parent.kind)) {
    const decl = owner.parent as ts.VariableDeclaration | ts.PropertyDeclaration | ts.PropertyAssignment;
    if (ts.isIdentifier(decl.name)) return decl.name.text;
  }
  return '<top>';
}

function functionNameOf(node: ts.Node): string {
  const fn = node as ts.FunctionLikeDeclaration;
  if (ts.isConstructorDeclaration(node)) {
    return `${ownerNameOf(node.parent)}.constructor`;
  }
  if (ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) {
    const memberName = fn.name && ts.isIdentifier(fn.name) ? fn.name.text : '<unnamed>';
    return `${ownerNameOf(node.parent)}.${memberName}`;
  }
  if (fn.name && ts.isIdentifier(fn.name)) {
    return fn.name.text;
  }
  const parent = node.parent;
  if (parent && NAME_BOUNDING_PARENTS.has(parent.kind)) {
    const decl = parent as ts.VariableDeclaration | ts.PropertyDeclaration | ts.PropertyAssignment;
    if (ts.isIdentifier(decl.name)) return decl.name.text;
  }
  const sf = node.getSourceFile();
  return `<anonymous:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}>`;
}

export function collectUnitsFromSource(sourceText: string, file: string): Unit[] {
  const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const units: Unit[] = [];
  const visit = (node: ts.Node, ownerChain: string[]) => {
    if (FUNCTION_LIKE.has(node.kind)) {
      const name = functionNameOf(node);
      const start = sf.getLineAndCharacterOfPosition(node.getStart());
      const end = sf.getLineAndCharacterOfPosition(node.getEnd());
      units.push({
        file,
        name,
        startLine: start.line + 1,
        endLine: end.line + 1,
        node,
      });
      ownerChain.push(name);
    }
    for (const child of node.getChildren(sf)) visit(child, ownerChain);
    if (FUNCTION_LIKE.has(node.kind)) ownerChain.pop();
  };
  visit(sf, []);
  return units.sort((a, b) => a.startLine - b.startLine);
}

export function collectUnits(sourceRoot: string, warn?: (msg: string) => void): Unit[] {
  const units: Unit[] = [];
  for (const file of listSourceFiles(sourceRoot)) {
    const sourceText = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
    const diagnostics = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
    if (diagnostics.length > 0) {
      warn?.(`cannot parse, skipped: ${file}`);
      continue;
    }
    units.push(...collectUnitsFromSource(sourceText, file));
  }
  return units;
}

export function normalizeSlice(node: ts.Node): string {
  const text = node.getText();
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function unitHash(node: ts.Node): string {
  return createHash('sha256').update(normalizeSlice(node)).digest('hex');
}
