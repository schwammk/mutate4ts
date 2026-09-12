import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync, readFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectUnitsFromSource } from '../src/units.js';
import { collectSites } from '../src/sites.js';
import {
  defaultIo,
  BaselineError,
  runBaseline,
  prepareWorker,
  runMutant,
  disposeWorker,
} from '../src/runner.js';

describe('runBaseline', () => {
  it('returns the duration in ms when the command exits 0', async () => {
    const ms = await runBaseline(defaultIo, 'node -e "process.exit(0)"', process.cwd());
    expect(ms).toBeGreaterThan(0);
  });

  it('throws BaselineError with output when the command fails', async () => {
    await expect(runBaseline(defaultIo, 'node -e "process.exit(3)"', process.cwd())).rejects.toBeInstanceOf(
      BaselineError,
    );
  });
});

describe('worker isolation and runMutant', () => {
  let root: string;
  let worker: string;
  afterEach(() => {
    if (worker) disposeWorker(worker);
    if (root) rmSync(root, { recursive: true, force: true });
    worker = '';
    root = '';
  });

  it('copies the project excluding .git and .mutate4ts, symlinks node_modules, applies the mutant in the copy', async () => {
    root = mkdtempSync(join(tmpdir(), 'm4t-run-'));
    writeFileSync(join(root, 'src.ts'), 'export function f(a) {\n  return a + 1;\n}\n');
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main');
    mkdirSync(join(root, '.mutate4ts'));
    const workerNodeModules = join(root, 'node_modules');
    mkdirSync(workerNodeModules);
    symlinkSync('/nonexistent-target-check', join(workerNodeModules, '.keep'), 'file');
    worker = prepareWorker(root);
    expect(existsSync(join(worker, '.git'))).toBe(false);
    expect(existsSync(join(worker, '.mutate4ts'))).toBe(false);
    expect(existsSync(join(worker, 'src.ts'))).toBe(true);
    expect(lstatSync(join(worker, 'node_modules')).isSymbolicLink()).toBe(true);

    const [unit] = collectUnitsFromSource(readFileSync(join(root, 'src.ts'), 'utf8'), 'src.ts');
    const [site] = collectSites(readFileSync(join(root, 'src.ts'), 'utf8'), 'src.ts', [unit]);
    const result = await runMutant(
      defaultIo,
      worker,
      'src.ts',
      site,
      'node -e "process.exit(0)"',
      10_000,
    );
    expect(result).toBe('SURVIVED');
    expect(readFileSync(join(root, 'src.ts'), 'utf8')).toBe('export function f(a) {\n  return a + 1;\n}\n');
  });

  it('classifies killed when the test command exits non-zero', async () => {
    root = mkdtempSync(join(tmpdir(), 'm4t-run-'));
    writeFileSync(join(root, 'src.ts'), 'export function f(a) {\n  return a + 1;\n}\n');
    worker = prepareWorker(root);
    const text = readFileSync(join(root, 'src.ts'), 'utf8');
    const [unit] = collectUnitsFromSource(text, 'src.ts');
    const [site] = collectSites(text, 'src.ts', [unit]);
    const result = await runMutant(
      defaultIo,
      worker,
      'src.ts',
      site,
      'node -e "process.exit(1)"',
      10_000,
    );
    expect(result).toBe('KILLED');
  });

  it('classifies a timeout as SURVIVED', async () => {
    root = mkdtempSync(join(tmpdir(), 'm4t-run-'));
    writeFileSync(join(root, 'src.ts'), 'export function f(a) {\n  return a + 1;\n}\n');
    worker = prepareWorker(root);
    const text = readFileSync(join(root, 'src.ts'), 'utf8');
    const [unit] = collectUnitsFromSource(text, 'src.ts');
    const [site] = collectSites(text, 'src.ts', [unit]);
    const result = await runMutant(
      defaultIo,
      worker,
      'src.ts',
      site,
      'node -e "setTimeout(() => {}, 60_000)"',
      300,
    );
    expect(result).toBe('SURVIVED');
  });
});
