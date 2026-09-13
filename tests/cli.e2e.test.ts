import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const cliPath = join(import.meta.dirname, '..', 'dist', 'cli.js');

describe('built CLI end-to-end', () => {
  let root: string;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function freshFixture(): string {
    root = mkdtempSync(join(tmpdir(), 'm4t-e2e-'));
    mkdirSync(join(root, 'tests/fixtures/project/src'), { recursive: true });
    mkdirSync(join(root, 'tests/fixtures/project/coverage'), { recursive: true });
    const fixtureRoot = join(import.meta.dirname, 'fixtures/project');
    writeFileSync(join(root, 'tests/fixtures/project/src/pricing.ts'), readFileSync(join(fixtureRoot, 'src/pricing.ts'), 'utf8'));
    writeFileSync(join(root, 'tests/fixtures/project/coverage/lcov.info'), readFileSync(join(fixtureRoot, 'coverage/lcov.info'), 'utf8'));
    writeFileSync(join(root, 'run-tests.js'), readFileSync(join(fixtureRoot, 'run-tests.js'), 'utf8'));
    return root;
  }

  it('prints the report and exits 3 on the mixed fixture', () => {
    const dir = freshFixture();
    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        '--source-root', 'tests/fixtures/project/src',
        '--test-command', 'node run-tests.js',
        '--lcov', 'tests/fixtures/project/coverage/lcov.info',
        '--mutate-all',
      ],
      { cwd: dir, encoding: 'utf8' },
    );
    expect(result.status).toBe(3);
    expect(result.stdout).toContain('killed: 9  survived: 2  not-covered: 1');
    expect(result.stdout).toContain('SURVIVED');
  });

  it('exits 1 on unknown flags', () => {
    const dir = freshFixture();
    const result = spawnSync(process.execPath, [cliPath, '--bogus'], { cwd: dir, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown option');
  });

  it('works through a symlinked binary (main-entry guard regression)', () => {
    const dir = freshFixture();
    const linkDir = mkdtempSync(join(tmpdir(), 'm4t-link-'));
    try {
      const link = join(linkDir, 'mutate4ts');
      symlinkSync(realpathSync(cliPath), link, 'file');
      const result = spawnSync(
        process.execPath,
        [
          link,
          '--source-root', 'tests/fixtures/project/src',
          '--test-command', 'node run-tests.js',
          '--mutate-all',
          '--scan',
        ],
        { cwd: dir, encoding: 'utf8' },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('12 sites');
    } finally {
      rmSync(linkDir, { recursive: true, force: true });
    }
  });
});
