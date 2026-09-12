#!/usr/bin/env node

export class CliError extends Error {}

export interface Config {
  sourceRoot: string;
  testCommand?: string;
  mutateAll: boolean;
  mutationIds: string[];
  lines?: { from: number; to: number };
  scan: boolean;
  lcovPaths: string[];
  timeoutFactor: number;
  format: 'text' | 'json';
}

interface MutableConfig {
  sourceRoot?: string;
  testCommand?: string;
  mutateAll: boolean;
  mutationIds: string[];
  lines?: { from: number; to: number };
  scan: boolean;
  lcovPaths: string[];
  timeoutFactor?: number;
  format?: 'text' | 'json';
}

function needValue(argv: string[], i: number, flag: string): string {
  if (i + 1 >= argv.length) throw new CliError(`missing value for ${flag}`);
  return argv[i + 1];
}

function parseTimeoutFactor(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === '' || !/^\d+$/.test(trimmed)) {
    throw new CliError('--timeout-factor must be a non-negative integer');
  }
  return Number(trimmed);
}

function parseLines(raw: string): { from: number; to: number } {
  const m = raw.match(/^(\d+)-(\d+)$/);
  if (!m) throw new CliError('--lines must be of the form <from>-<to> with from <= to');
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (to < from) throw new CliError('--lines must be of the form <from>-<to> with from <= to');
  return { from, to };
}

function parseMutationId(raw: string): string {
  if (!/^M\d{3,}$/.test(raw)) throw new CliError(`--mutation must be an id like M017, got: ${raw}`);
  return raw;
}

export function parseArgs(argv: string[]): Config {
  const c: MutableConfig = { mutateAll: false, mutationIds: [], scan: false, lcovPaths: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--source-root':
        c.sourceRoot = needValue(argv, i, arg);
        i += 1;
        break;
      case '--test-command':
        c.testCommand = needValue(argv, i, arg);
        i += 1;
        break;
      case '--mutate-all':
        c.mutateAll = true;
        break;
      case '--mutation':
        c.mutationIds.push(parseMutationId(needValue(argv, i, arg)));
        i += 1;
        break;
      case '--lines':
        c.lines = parseLines(needValue(argv, i, arg));
        i += 1;
        break;
      case '--scan':
        c.scan = true;
        break;
      case '--lcov':
        c.lcovPaths.push(needValue(argv, i, arg));
        i += 1;
        break;
      case '--timeout-factor':
        c.timeoutFactor = parseTimeoutFactor(needValue(argv, i, arg));
        i += 1;
        break;
      case '--format': {
        const value = needValue(argv, i, arg);
        if (value !== 'text' && value !== 'json') throw new CliError(`--format must be text or json, got: ${value}`);
        c.format = value;
        i += 1;
        break;
      }
      default:
        throw new CliError(`unknown option: ${arg}`);
    }
  }
  return {
    sourceRoot: c.sourceRoot ?? 'src',
    testCommand: c.testCommand,
    mutateAll: c.mutateAll,
    mutationIds: c.mutationIds,
    lines: c.lines,
    scan: c.scan,
    lcovPaths: c.lcovPaths,
    timeoutFactor: c.timeoutFactor ?? 10,
    format: c.format ?? 'text',
  };
}
