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

function groupByFile(units: Unit[]): Map<string, Unit[]> {
  const byFile = new Map<string, Unit[]>();
  for (const u of units) {
    if (!byFile.has(u.file)) byFile.set(u.file, []);
    byFile.get(u.file)!.push(u);
  }
  return byFile;
}

function scanMode(relUnits: Unit[], warnings: string[], repoRoot: string, io: Io): number {
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

function resolveCommands(
  config: Config,
  relUnits: Unit[],
  repoRoot: string,
  io: Io,
): Map<string, string> | null {
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
      return null;
    }
    commands.set(u.file, inferred);
  }
  if (!config.testCommand) {
    const first = commands.get(relUnits[0].file)!;
    for (const u of relUnits) {
      if (commands.get(u.file) !== first) {
        io.stderr(`inferred test commands are inconsistent across files: ${u.file}\n`);
        return null;
      }
    }
  }
  return commands;
}

function loadManifests(relUnits: Unit[], repoRoot: string): Map<string, Manifest | null> {
  const manifests = new Map<string, Manifest | null>();
  for (const u of relUnits) {
    if (!manifests.has(u.file)) {
      const text = readFileSync(join(repoRoot, u.file), 'utf8');
      manifests.set(u.file, parseManifest(text));
    }
  }
  return manifests;
}

function selectTargets(
  config: Config,
  relUnits: Unit[],
  manifests: Map<string, Manifest | null>,
  profile: string,
): Unit[] {
  if (config.mutateAll) return relUnits;
  return relUnits.filter(
    (u) => selectChanged([u], manifests.get(u.file) ?? null, profile).length > 0,
  );
}

function collectSitesForTargets(
  repoRoot: string,
  byFile: Map<string, Unit[]>,
  selectedFiles: Set<string>,
): Map<string, MutationSite[]> {
  const sitesByFile = new Map<string, MutationSite[]>();
  for (const [file, fileUnits] of byFile) {
    if (!selectedFiles.has(file)) continue;
    const text = readFileSync(join(repoRoot, file), 'utf8');
    sitesByFile.set(file, collectSites(text, file, fileUnits));
  }
  return sitesByFile;
}

function loadCoverageFilter(
  config: Config,
  relUnits: Unit[],
  warn: (msg: string) => void,
): LcovFile[] {
  if (config.lcovPaths.length === 0) {
    warn('no coverage data provided, skipping coverage filter');
    return [];
  }
  const merged = mergeLcov(config.lcovPaths);
  for (const m of merged.missing) warn(`lcov not found: ${m}`);
  if (merged.files.length === 0) {
    warn('no coverage records found in provided lcov files, skipping coverage filter');
    return [];
  }
  if (coverageStale(merged.files, relUnits)) {
    warn('coverage stale, run tests with coverage first');
    return [];
  }
  return merged.files;
}

interface MutationRun {
  repoRoot: string;
  config: Config;
  byFile: Map<string, Unit[]>;
  selectedFiles: Set<string>;
  selectedUnitsByFile: Map<string, Unit[]>;
  sitesByFile: Map<string, MutationSite[]>;
  commands: Map<string, string>;
  lcovFiles: LcovFile[];
  timeoutMs: number;
}

async function runMutants(io: Io, run: MutationRun): Promise<MutantResult[] | null> {
  const {
    repoRoot,
    config,
    byFile,
    selectedFiles,
    selectedUnitsByFile,
    sitesByFile,
    commands,
    lcovFiles,
    timeoutMs,
  } = run;
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
    return results;
  } catch (e) {
    for (const w of workerByFile.values()) disposeWorker(w);
    io.stderr(`engine error: ${(e as Error).message}\n`);
    return null;
  } finally {
    for (const w of workerByFile.values()) disposeWorker(w);
  }
}

function certify(
  repoRoot: string,
  byFile: Map<string, Unit[]>,
  selectedFiles: Set<string>,
  sitesByFile: Map<string, MutationSite[]>,
  profile: string,
): void {
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

  if (config.scan) return scanMode(relUnits, warnings, repoRoot, io);

  const commands = resolveCommands(config, relUnits, repoRoot, io);
  if (!commands) return 1;
  const profile = testProfile(commands.get(relUnits[0].file)!);

  let manifests: Map<string, Manifest | null>;
  try {
    manifests = loadManifests(relUnits, repoRoot);
  } catch (e) {
    io.stderr(`${(e as Error).message}\n`);
    return 1;
  }
  const selected = selectTargets(config, relUnits, manifests, profile);
  if (selected.length === 0) {
    io.stderr('nothing to mutate\n');
    return 0;
  }

  const byFile = groupByFile(relUnits);
  const selectedFiles = new Set(selected.map((u) => u.file));
  const selectedUnitsByFile = groupByFile(selected);
  const sitesByFile = collectSitesForTargets(repoRoot, byFile, selectedFiles);

  let lcovFiles: LcovFile[];
  try {
    lcovFiles = loadCoverageFilter(config, relUnits, warn);
  } catch (e) {
    io.stderr(`${(e as Error).message}\n`);
    return 1;
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

  const isNarrow = config.mutationIds.length > 0 || config.lines !== undefined;
  const results = await runMutants(io, {
    repoRoot,
    config,
    byFile,
    selectedFiles,
    selectedUnitsByFile,
    sitesByFile,
    commands,
    lcovFiles,
    timeoutMs,
  });
  if (results === null) return 4;

  // report
  const report = config.format === 'json' ? renderJson(results) : renderText(results);
  io.stdout(mergeFiles('', report));
  for (const w of warnings) io.stderr(`${w}\n`);

  const survivors = results.filter((r) => r.status === 'SURVIVED').length;
  const notCovered = results.filter((r) => r.status === 'NOT-COVERED').length;
  if (survivors > 0 || notCovered > 0) return 3;
  if (isNarrow) return 0; // narrow reruns report but never certify (never write the manifest)

  certify(repoRoot, byFile, selectedFiles, sitesByFile, profile);
  return 0;
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
if (isMain) {
  const exit = await runCli(process.argv.slice(2));
  process.exitCode = exit;
}
