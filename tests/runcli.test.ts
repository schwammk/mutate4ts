import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, inferTestCommand } from '../src/cli.js';
import { defaultIo } from '../src/runner.js';

const cwdAtLoad = process.cwd();

const recordingIo = () => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (t: string) => out.push(t),
      stderr: (t: string) => err.push(t),
      exec: defaultIo.exec,
    } as typeof defaultIo,
    out,
    err,
  };
};

describe('inferTestCommand', () => {
  it('maps a file to the nearest ancestor project.json project', () => {
    const root = mkdtempSync(join(tmpdir(), 'm4t-nx-'));
    try {
      writeFileSync(join(root, 'nx.json'), '{}');
      mkdirSync(join(root, 'packages', 'app'), { recursive: true });
      writeFileSync(join(root, 'packages', 'app', 'project.json'), JSON.stringify({ name: 'app' }));
      mkdirSync(join(root, 'packages', 'app', 'src'), { recursive: true });
      writeFileSync(join(root, 'packages', 'app', 'src', 'x.ts'), 'export const x = 1;\n');
      expect(inferTestCommand(root, 'packages/app/src/x.ts')).toBe(
        'npx nx run-many -t test --projects=app',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns null when there is no nx.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'm4t-nx-'));
    try {
      expect(inferTestCommand(root, 'src/x.ts')).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('runCli', () => {
  let root: string;
  afterEach(() => {
    process.chdir(cwdAtLoad);
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function freshFixture(): string {
    root = mkdtempSync(join(tmpdir(), 'm4t-cli-'));
    process.chdir(root);
    mkdirSync(join(root, 'tests/fixtures/project/src'), { recursive: true });
    mkdirSync(join(root, 'tests/fixtures/project/coverage'), { recursive: true });
    const fixtureRoot = join(import.meta.dirname, 'fixtures/project');
    for (const f of ['src/pricing.ts']) {
      writeFileSync(join(root, 'tests/fixtures/project', f), readFileSync(join(fixtureRoot, f), 'utf8'));
    }
    writeFileSync(join(root, 'tests/fixtures/project/coverage/lcov.info'), readFileSync(join(fixtureRoot, 'coverage/lcov.info'), 'utf8'));
    writeFileSync(join(root, 'run-tests.js'), readFileSync(join(fixtureRoot, 'run-tests.js'), 'utf8'));
    return root;
  }

  it('runs the full pipeline: 9 killed, 2 survived, 1 not-covered → exit 3', async () => {
    const dir = freshFixture();
    const { io, out } = recordingIo();
    const exit = await runCli(
      [
        '--source-root', 'tests/fixtures/project/src',
        '--test-command', 'node run-tests.js',
        '--lcov', 'tests/fixtures/project/coverage/lcov.info',
        '--mutate-all',
      ],
      io,
    );
    expect(exit).toBe(3);
    expect(out.join('')).toContain('killed: 9  survived: 2  not-covered: 1');
    expect(out.join('')).toContain('M009');
    expect(out.join('')).toContain('SURVIVED');
    expect(out.join('')).toContain('NOT-COVERED');
    // survivors + not-covered block certification: no manifest written
    expect(readFileSync(join(dir, 'tests/fixtures/project/src/pricing.ts'), 'utf8')).not.toContain('mutate4ts-manifest');
  });

  it('writes the manifest after a fully-killing run and exits 0 (differential second run: nothing to mutate)', async () => {
    const dir = freshFixture();
    // overwrite pricing.ts with the fully-tested clean fixture (all mutants killed by run-tests.js)
    const fixtureRoot = join(import.meta.dirname, 'fixtures/project');
    writeFileSync(join(dir, 'tests/fixtures/project/src/pricing.ts'), readFileSync(join(fixtureRoot, 'src/clean-pricing.ts'), 'utf8'));
    const { io, err } = recordingIo();
    // no --lcov: the fixture lcov records clamp/rounded, which do not exist in the clean
    // variant and would trip the staleness check; without coverage data the run warns
    // 'no coverage ...' and filters nothing — all 7 sites run, all die, manifest written.
    const first = await runCli(
      [
        '--source-root', 'tests/fixtures/project/src',
        '--test-command', 'node run-tests.js',
        '--mutate-all',
      ],
      io,
    );
    expect(first).toBe(0);
    const withManifest = readFileSync(join(dir, 'tests/fixtures/project/src/pricing.ts'), 'utf8');
    expect(withManifest).toContain('mutate4ts-manifest v1');
    expect(err.join('')).toContain('no coverage');

    const { io: io2, err: err2 } = recordingIo();
    const second = await runCli(
      [
        '--source-root', 'tests/fixtures/project/src',
        '--test-command', 'node run-tests.js',
      ],
      io2,
    );
    expect(second).toBe(0);
    expect(err2.join('')).toContain('nothing to mutate');
  });

  it('warns and proceeds unfiltered when coverage is stale', async () => {
    const dir = freshFixture();
    // drop the `discount` record from the lcov → the key set no longer matches the
    // enumeration exactly → stale → warn + unfiltered
    const lcovPath = join(dir, 'tests/fixtures/project/coverage/lcov.info');
    writeFileSync(
      lcovPath,
      readFileSync(lcovPath, 'utf8').replace(/^FN:1,discount\nFNDA:5,discount\n/m, ''),
    );
    const { io, err, out } = recordingIo();
    const exit = await runCli(
      [
        '--source-root', 'tests/fixtures/project/src',
        '--test-command', 'node run-tests.js',
        '--lcov', 'tests/fixtures/project/coverage/lcov.info',
        '--mutate-all',
        '--format', 'json',
      ],
      io,
    );
    expect(err.join('')).toContain('coverage stale, run tests with coverage first');
    expect(exit).toBe(3);
    expect(out.join('')).toContain('"status": "SURVIVED"');
  });

  it('scan mode prints per-file and per-rule counts, never runs tests, exits 0', async () => {
    const dir = freshFixture();
    const { io, out, err } = recordingIo();
    const exit = await runCli(
      ['--source-root', 'tests/fixtures/project/src', '--scan'],
      io,
    );
    expect(exit).toBe(0);
    expect(out.join('')).toContain('tests/fixtures/project/src/pricing.ts: 12 sites');
    expect(out.join('')).toContain('boundary-gt: 4');
    expect(err.join('')).not.toContain('exec');
    expect(existsSync(join(dir, '.mutate4ts'))).toBe(false);
  });

  it('narrow rerun by --mutation never writes the manifest', async () => {
    const dir = freshFixture();
    const { io } = recordingIo();
    const exit = await runCli(
      [
        '--source-root', 'tests/fixtures/project/src',
        '--test-command', 'node run-tests.js',
        '--mutation', 'M001',
      ],
      io,
    );
    expect(exit).toBe(0); // M001 is killed by the stub runner
    expect(readFileSync(join(dir, 'tests/fixtures/project/src/pricing.ts'), 'utf8')).not.toContain('mutate4ts-manifest');
  });

  it('CliError from parseArgs exits 1', async () => {
    const { io, err } = recordingIo();
    const exit = await runCli(['--bogus'], io);
    expect(exit).toBe(1);
    expect(err.join('')).toContain('unknown option');
  });

  it('missing test command without Nx workspace exits 1', async () => {
    freshFixture(); // has no nx.json → inference fails for the only file
    const { io, err } = recordingIo();
    const exit = await runCli(
      ['--source-root', 'tests/fixtures/project/src', '--mutate-all'],
      io,
    );
    expect(exit).toBe(1);
    expect(err.join('')).toContain('no test command and no Nx workspace');
  });
});
