import { describe, it, expect } from 'vitest';
import { parseArgs, CliError, runCli, extendedHelp } from '../src/cli.js';
import type { Io } from '../src/cli.js';

describe('parseArgs', () => {
  it('applies documented defaults', () => {
    const config = parseArgs([]);
    expect(config).toEqual({
      sourceRoot: 'src',
      mutateAll: false,
      mutationIds: [],
      scan: false,
      lcovPaths: [],
      timeoutFactor: 10,
      format: 'text',
    });
    expect(config.testCommand).toBeUndefined();
    expect(config.lines).toBeUndefined();
  });

  it('parses all flags', () => {
    const config = parseArgs([
      '--source-root', 'packages',
      '--test-command', 'npm test',
      '--mutate-all',
      '--mutation', 'M003',
      '--mutation', 'M007',
      '--lines', '42-60',
      '--lcov', 'cov/a.info',
      '--lcov', 'cov/b.info',
      '--timeout-factor', '5',
      '--format', 'json',
      '--scan',
    ]);
    expect(config).toEqual({
      sourceRoot: 'packages',
      testCommand: 'npm test',
      mutateAll: true,
      mutationIds: ['M003', 'M007'],
      lines: { from: 42, to: 60 },
      scan: true,
      lcovPaths: ['cov/a.info', 'cov/b.info'],
      timeoutFactor: 5,
      format: 'json',
    });
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(CliError);
  });

  it('rejects missing flag values', () => {
    expect(() => parseArgs(['--source-root'])).toThrow(CliError);
    expect(() => parseArgs(['--test-command'])).toThrow(CliError);
  });

  it('rejects non-numeric, empty, or non-integer --timeout-factor', () => {
    expect(() => parseArgs(['--timeout-factor', 'abc'])).toThrow(CliError);
    expect(() => parseArgs(['--timeout-factor', ''])).toThrow(CliError);
    expect(() => parseArgs(['--timeout-factor', '   '])).toThrow(CliError);
    expect(() => parseArgs(['--timeout-factor', '1.5'])).toThrow(CliError);
    expect(() => parseArgs(['--timeout-factor', '-1'])).toThrow(CliError);
    expect(() => parseArgs(['--timeout-factor', '0x10'])).toThrow(CliError);
    expect(parseArgs(['--timeout-factor', '12']).timeoutFactor).toBe(12);
  });

  it('rejects --timeout-factor 0 (must be >= 1)', () => {
    expect(() => parseArgs(['--timeout-factor', '0'])).toThrow(CliError);
  });

  it('rejects malformed --lines', () => {
    expect(() => parseArgs(['--lines', '42'])).toThrow(CliError);
    expect(() => parseArgs(['--lines', '60-42'])).toThrow(CliError);
    expect(() => parseArgs(['--lines', 'a-b'])).toThrow(CliError);
    expect(() => parseArgs(['--lines', '-5-10'])).toThrow(CliError);
    expect(parseArgs(['--lines', '42-60']).lines).toEqual({ from: 42, to: 60 });
  });

  it('rejects malformed --mutation ids', () => {
    expect(() => parseArgs(['--mutation', '17'])).toThrow(CliError);
    expect(() => parseArgs(['--mutation', 'm001'])).toThrow(CliError);
    expect(() => parseArgs(['--mutation', 'M1'])).toThrow(CliError);
    expect(parseArgs(['--mutation', 'M001']).mutationIds).toEqual(['M001']);
  });

  it('rejects bad --format values', () => {
    expect(() => parseArgs(['--format', 'xml'])).toThrow(CliError);
    expect(parseArgs(['--format', 'text']).format).toBe('text');
  });
});

describe('help', () => {
  const recordingIo = (): { io: Io; out: string[]; err: string[] } => {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { stdout: (s) => out.push(s), stderr: (s) => err.push(s) }, out, err };
  };

  it('exposes extended help for known options', () => {
    const text = extendedHelp(['--help', 'timeout-factor']);
    expect(text).toBeTruthy();
    expect(text!).toMatch(/baseline/i);
    expect(text!.length).toBeGreaterThan(80);
  });

  it('falls back to null for unknown topics and plain --help', () => {
    expect(extendedHelp(['--help', 'nope'])).toBeNull();
    expect(extendedHelp(['--help'])).toBeNull();
    expect(extendedHelp([])).toBeNull();
  });

  it('runCli prints extended help for a topic and exits 0', async () => {
    const { io, out } = recordingIo();
    expect(await runCli(['--help', 'mutation'], io)).toBe(0);
    expect(out.join('')).toMatch(/M\d{3}/);
  });

  it('runCli prints generic help for plain --help and exits 0', async () => {
    const { io, out } = recordingIo();
    expect(await runCli(['--help'], io)).toBe(0);
    expect(out.join('')).toMatch(/mutate4ts/);
  });
});
