import { readFileSync } from 'node:fs';
import { Unit } from './units.js';

export interface LcovFunction {
  name: string;
  line: number;
  hits: number;
}

export interface LcovFile {
  file: string;
  functions: LcovFunction[];
}

const SKIPPED = ['TN:', 'DA:', 'LF:', 'LH:', 'FNF:', 'FNH:', 'BRF:', 'BRH:', 'BRDA:'];

export function parseLcov(text: string, sourceName = '<lcov>'): LcovFile[] {
  const files: LcovFile[] = [];
  let current: LcovFile | null = null;
  let pending = new Map<string, number>();
  let hits = new Map<string, number>();
  let recordNo = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    if (SKIPPED.some((p) => line.startsWith(p))) continue;
    if (line.startsWith('SF:')) {
      recordNo += 1;
      current = { file: line.slice(3), functions: [] };
      pending = new Map();
      hits = new Map();
      continue;
    }
    if (line.startsWith('FN:')) {
      const [lineNo, name] = line.slice(3).split(',');
      pending.set(name, Number(lineNo));
      continue;
    }
    if (line.startsWith('FNDA:')) {
      const [count, name] = line.slice(5).split(',');
      hits.set(name, Number(count));
      continue;
    }
    if (line.startsWith('end_of_record')) {
      if (current) {
        for (const [name, ln] of pending) {
          current.functions.push({ name, line: ln, hits: hits.get(name) ?? 0 });
        }
        files.push(current);
        current = null;
      }
      continue;
    }
    throw new Error(`malformed LCOV record in ${sourceName} (record ${Math.max(recordNo, 1)}): "${line}"`);
  }
  return files;
}

export function mergeLcov(paths: string[]): { files: LcovFile[]; missing: string[] } {
  const files = new Map<string, LcovFile>();
  const missing: string[] = [];
  for (const path of paths) {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      missing.push(path);
      continue;
    }
    for (const parsed of parseLcov(text, path)) {
      const existing = files.get(parsed.file);
      if (!existing) {
        files.set(parsed.file, parsed);
        continue;
      }
      const byKey = new Map(existing.functions.map((f) => [`${f.name}|${f.line}`, f]));
      for (const f of parsed.functions) {
        const key = `${f.name}|${f.line}`;
        const prev = byKey.get(key);
        if (prev) prev.hits = Math.max(prev.hits, f.hits);
        else {
          byKey.set(key, f);
          existing.functions.push(f);
        }
      }
    }
  }
  return { files: [...files.values()].sort((a, b) => a.file.localeCompare(b.file)), missing };
}

export function unitKey(file: string, name: string, startLine: number): string {
  return `${file}|${name}|${startLine}`;
}

export function coveredUnits(files: LcovFile[]): Set<string> {
  const covered = new Set<string>();
  for (const f of files) {
    for (const fn of f.functions) {
      if (fn.hits > 0) covered.add(unitKey(f.file, fn.name, fn.line));
    }
  }
  return covered;
}

export function unitKeys(units: Unit[]): Set<string> {
  return new Set(units.map((u) => unitKey(u.file, u.name, u.startLine)));
}

export function coverageStale(files: LcovFile[], units: Unit[]): boolean {
  const lcovFnKeys = new Set<string>();
  for (const f of files) {
    for (const fn of f.functions) lcovFnKeys.add(unitKey(f.file, fn.name, fn.line));
  }
  const unitKeySet = unitKeys(units);
  if (lcovFnKeys.size !== unitKeySet.size) return true;
  for (const k of lcovFnKeys) if (!unitKeySet.has(k)) return true;
  return false;
}

export function isCovered(file: string, name: string, startLine: number, files: LcovFile[]): boolean {
  for (const f of files) {
    if (f.file !== file) continue;
    for (const fn of f.functions) {
      if (fn.name === name && fn.line === startLine) return fn.hits > 0;
    }
  }
  return false;
}
