#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectUnits, Unit, unitHash, RULE_VERSION } from './units.js';
import { collectSites, MutationSite, RULE_NAMES } from './sites.js';
import {
  parseManifest,
  appendManifest,
  stripManifest,
  Manifest,
  ManifestFunction,
  testProfile,
  selectChanged,
} from './manifest.js';
import {
  mergeLcov,
  coverageStale,
  isCovered,
  LcovFile,
} from './coverage.js';
import {
  Io,
  defaultIo,
  runBaseline,
  prepareWorker,
  runMutant,
  disposeWorker,
  BaselineError,
} from './runner.js';
import { MutantResult, renderText, renderJson } from './report.js';

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
  if (trimmed === '' || !/^\d+$/.test(trimmed) || Number(trimmed) < 1) {
    throw new CliError('--timeout-factor must be an integer >= 1');
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

export function inferTestCommand(repoRoot: string, relFile: string): string | null {
  if (!existsSync(join(repoRoot, 'nx.json'))) return null;
  let dir = dirname(resolve(repoRoot, relFile));
  const repo = resolve(repoRoot);
  while (dir.startsWith(repo) && dir !== repo) {
    const pj = join(dir, 'project.json');
    if (existsSync(pj)) {
      const parsed = JSON.parse(readFileSync(pj, 'utf8')) as { name?: string };
      const name = parsed.name ?? dir.split('/').pop();
      if (name) return `npx nx run-many -t test --projects=${name}`;
    }
    dir = dirname(dir);
  }
  return null;
}

function mergeFiles(base: string, extra: string): string {
  return base.endsWith('\n') ? base + extra : `${base}\n${extra}`;
}

export async function runCli(argv: string[], io: Io = defaultIo): Promise<number> {
  let config: Config;
  try {
    config = parseArgs(argv);
  } catch (e) {
    io.stderr(`${(e as Error).message}\n`);
    return 1;
  }

  const repoRoot = process.cwd();
  let sourceRoot = config.sourceRoot;
  if (!existsSync(sourceRoot)) {
    io.stderr(`source root not found, falling back to '.'\n`);
    sourceRoot = '.';
  }

  const warnings: string[] = [];
  const warn = (msg: string) => warnings.push(msg);
  const units = collectUnits(sourceRoot, warn);
  if (units.length === 0) {
    io.stderr('no functions found\n');
    return 0;
  }
  const relUnits = units.map((u) => ({ ...u, file: relative(repoRoot, resolve(u.file)) || u.file }));

  // scan mode: per-file rule counts, no tests, no manifest
  if (config.scan) {
    const perFile = new Map<string, number>();
    const perRule = new Map<string, number>();
    for (const u of relUnits) {
      const text = readFileSync(join(repoRoot, u.file), 'utf8');
      const sites = collectSites(text, u.file, [u]);
      if (!perFile.has(u.file)) perFile.set(u.file, 0);
      perFile.set(u.file, perFile.get(u.file)! + sites.length);
      for (const s of sites) {
        perRule.set(s.rule, (perRule.get(s.rule) ?? 0) + 1);
      }
    }
    for (const [file, count] of perFile) io.stdout(`${file}: ${count} sites\n`);
    io.stdout(
      `${RULE_NAMES.map((r) => `${r}: ${perRule.get(r) ?? 0}`).join('  ')}\n`,
    );
    for (const w of warnings) io.stderr(`${w}\n`);
    return 0;
  }

  // resolve test commands (explicit flag, else Nx inference per file) and the
  // effective profile for the manifest fingerprint
  const commands = new Map<string, string>();
  for (const u of relUnits) {
    if (commands.has(u.file)) continue;
    if (config.testCommand) {
      commands.set(u.file, config.testCommand);
      continue;
    }
    const inferred = inferTestCommand(repoRoot, u.file);
    if (!inferred) {
      io.stderr(`no test command and no Nx workspace found for ${u.file}\n`);
      return 1;
    }
    commands.set(u.file, inferred);
  }
  if (!config.testCommand) {
    const first = commands.get(relUnits[0].file)!;
    for (const u of relUnits) {
      if (commands.get(u.file) !== first) {
        io.stderr(`inferred test commands are inconsistent across files: ${u.file}\n`);
        return 1;
      }
    }
  }
  const profile = testProfile(commands.get(relUnits[0].file)!);

  // differential selection
  const manifests = new Map<string, Manifest | null>();
  try {
    for (const u of relUnits) {
      if (!manifests.has(u.file)) {
        const text = readFileSync(join(repoRoot, u.file), 'utf8');
        manifests.set(u.file, parseManifest(text));
      }
    }
  } catch (e) {
    io.stderr(`${(e as Error).message}\n`);
    return 1;
  }
  let selected: Unit[];
  if (config.mutateAll) {
    selected = relUnits;
  } else {
    selected = relUnits.filter((u) => {
      const changed = selectChanged([u], manifests.get(u.file) ?? null, profile);
      return changed.length > 0;
    });
  }
  if (selected.length === 0) {
    io.stderr('nothing to mutate\n');
    return 0;
  }

  // group units by file once; mutation IDs are assigned sequentially per
  // collectSites call, so sites are collected per file over ALL of the file's
  // units to keep IDs stable across selection modes
  const byFile = new Map<string, Unit[]>();
  for (const u of relUnits) {
    if (!byFile.has(u.file)) byFile.set(u.file, []);
    byFile.get(u.file)!.push(u);
  }
  const selectedFiles = new Set(selected.map((u) => u.file));
  const selectedUnitsByFile = new Map<string, Unit[]>();
  for (const u of selected) {
    if (!selectedUnitsByFile.has(u.file)) selectedUnitsByFile.set(u.file, []);
    selectedUnitsByFile.get(u.file)!.push(u);
  }
  const sitesByFile = new Map<string, MutationSite[]>();
  for (const [file, fileUnits] of byFile) {
    if (!selectedFiles.has(file)) continue;
    const text = readFileSync(join(repoRoot, file), 'utf8');
    sitesByFile.set(file, collectSites(text, file, fileUnits));
  }

  // coverage filter
  let lcovFiles: LcovFile[] = [];
  if (config.lcovPaths.length > 0) {
    let merged: { files: LcovFile[]; missing: string[] };
    try {
      merged = mergeLcov(config.lcovPaths);
    } catch (e) {
      io.stderr(`${(e as Error).message}\n`);
      return 1;
    }
    for (const m of merged.missing) warn(`lcov not found: ${m}`);
    if (merged.files.length === 0) {
      warn('no coverage records found in provided lcov files, skipping coverage filter');
    } else if (coverageStale(merged.files, relUnits)) {
      warn('coverage stale, run tests with coverage first');
      lcovFiles = [];
    } else {
      lcovFiles = merged.files;
    }
  } else {
    warn('no coverage data provided, skipping coverage filter');
  }

  // baseline
  let baselineMs: number;
  try {
    baselineMs = await runBaseline(io, commands.get(selected[0].file)!, repoRoot);
  } catch (e) {
    if (e instanceof BaselineError) return 2;
    io.stderr(`${(e as Error).message}\n`);
    return 2;
  }
  const timeoutMs = config.timeoutFactor * baselineMs;

  // narrow-rerun filter
  const isNarrow = config.mutationIds.length > 0 || config.lines !== undefined;
  const inLines = (s: MutationSite) =>
    config.lines !== undefined && s.startLine >= config.lines.from && s.startLine <= config.lines.to;
  const inIds = (s: MutationSite) => config.mutationIds.includes(s.id);

  const results: MutantResult[] = [];
  const workerByFile = new Map<string, string>();
  try {
    for (const [file, fileUnits] of byFile) {
      if (!selectedFiles.has(file)) continue;
      const allSites = sitesByFile.get(file)!;
      const sites = isNarrow ? allSites.filter((s) => inIds(s) || inLines(s)) : allSites;
      const selectedUnits = selectedUnitsByFile.get(file) ?? [];
      const command = commands.get(file)!;
      let worker: string | undefined;
      for (const site of sites) {
        const owner = fileUnits.find(
          (u) => u.name === site.name && site.startLine >= u.startLine && site.startLine <= u.endLine,
        );
        if (!owner || !selectedUnits.includes(owner)) continue;
        if (lcovFiles.length > 0 && !isCovered(file, owner.name, owner.startLine, lcovFiles)) {
          results.push({ id: site.id, rule: site.rule, file, name: owner.name, startLine: site.startLine, status: 'NOT-COVERED', seconds: null });
          continue;
        }
        if (!worker) {
          worker = prepareWorker(repoRoot);
          workerByFile.set(file, worker);
        }
        const started = Date.now();
        const verdict = await runMutant(io, worker, file, site, command, timeoutMs);
        results.push({
          id: site.id,
          rule: site.rule,
          file,
          name: owner.name,
          startLine: site.startLine,
          status: verdict,
          seconds: (Date.now() - started) / 1000,
        });
      }
    }
  } catch (e) {
    for (const w of workerByFile.values()) disposeWorker(w);
    io.stderr(`engine error: ${(e as Error).message}\n`);
    return 4;
  } finally {
    for (const w of workerByFile.values()) disposeWorker(w);
  }

  // report
  const report = config.format === 'json' ? renderJson(results) : renderText(results);
  io.stdout(mergeFiles('', report));
  for (const w of warnings) io.stderr(`${w}\n`);

  const survivors = results.filter((r) => r.status === 'SURVIVED').length;
  const notCovered = results.filter((r) => r.status === 'NOT-COVERED').length;
  if (survivors > 0 || notCovered > 0) return 3;
  if (isNarrow) return 0; // narrow reruns report but never certify (never write the manifest)

  // full/differential clean run → certify each fully-killed file: replace its manifest
  // with per-function entries for ALL of the file's units (recomputed hashes are
  // identical for unchanged functions, so nothing is weakened)
  for (const [file, fileUnits] of byFile) {
    if (!selectedFiles.has(file)) continue;
    const text = readFileSync(join(repoRoot, file), 'utf8');
    const sites = sitesByFile.get(file)!;
    const functions: ManifestFunction[] = fileUnits.map((u) => ({
      name: u.name,
      startLine: u.startLine,
      endLine: u.endLine,
      sha256: unitHash(u.node),
      mutations: sites.filter((s) => s.name === u.name).length,
    }));
    const manifest: Manifest = {
      date: new Date().toISOString(),
      ruleVersion: RULE_VERSION,
      testProfile: profile,
      functions,
    };
    writeFileSync(join(repoRoot, file), appendManifest(stripManifest(text), manifest));
  }
  return 0;
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
if (isMain) {
  const exit = await runCli(process.argv.slice(2));
  process.exitCode = exit;
}
