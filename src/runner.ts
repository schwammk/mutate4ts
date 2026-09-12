import { promisify } from 'node:util';
import { exec as execRaw } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, isAbsolute, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MutationSite, applyMutation } from './sites.js';

const execAsync = promisify(execRaw) as (
  command: string,
  opts: { cwd: string; timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  exec(command: string, opts: { cwd: string; timeout: number }): Promise<RunResult>;
}

export const defaultIo: Io = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  async exec(command, opts) {
    try {
      const { stdout, stderr } = await execAsync(command, { cwd: opts.cwd, timeout: opts.timeout });
      return { status: 0, stdout, stderr };
    } catch (e) {
      const err = e as { code?: number; killed?: boolean; stdout?: string; stderr?: string; message: string };
      const status = err.killed ? 124 : (err.code ?? 1);
      return { status, stdout: err.stdout ?? '', stderr: err.stderr !== undefined ? err.stderr : err.message };
    }
  },
};

export class BaselineError extends Error {
  constructor(public readonly stderr: string) {
    super('baseline test run failed');
  }
}

export async function runBaseline(io: Io, testCommand: string, cwd: string): Promise<number> {
  const started = Date.now();
  const result = await io.exec(testCommand, { cwd, timeout: 0 });
  if (result.status !== 0) {
    io.stderr(result.stderr);
    throw new BaselineError(result.stderr);
  }
  return Math.max(Date.now() - started, 1);
}

export function prepareWorker(repoRoot: string): string {
  const root = resolve(repoRoot);
  const workerDir = join(root, '.mutate4ts', `work-${randomUUID()}`);
  mkdirSync(workerDir, { recursive: true });
  const excluded = (rel: string) => rel === '.git' || rel === '.mutate4ts' || rel === 'node_modules';
  for (const entry of readdirSync(root)) {
    if (excluded(entry)) continue;
    cpSync(join(root, entry), join(workerDir, entry), {
      recursive: true,
      filter: (src) => {
        const rel = relative(root, src);
        if (rel === '') return true;
        return !excluded(rel.split('/')[0]);
      },
    });
  }
  const nm = join(root, 'node_modules');
  if (lstatSafe(nm)) symlinkSync(nm, join(workerDir, 'node_modules'), 'dir');
  return workerDir;
}

function lstatSafe(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

export async function runMutant(
  io: Io,
  workerDir: string,
  relPath: string,
  site: MutationSite,
  testCommand: string,
  timeoutMs: number,
): Promise<'KILLED' | 'SURVIVED'> {
  const target = isAbsolute(relPath) ? relPath : join(workerDir, relPath);
  const original = readFileSync(target, 'utf8');
  writeFileSync(target, applyMutation(original, site));
  try {
    const result = await io.exec(testCommand, { cwd: workerDir, timeout: timeoutMs });
    if (result.status === 124) return 'SURVIVED';
    return result.status === 0 ? 'SURVIVED' : 'KILLED';
  } finally {
    writeFileSync(target, original);
  }
}

export function disposeWorker(workerDir: string): void {
  rmSync(workerDir, { recursive: true, force: true });
}
