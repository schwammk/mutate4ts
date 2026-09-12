import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.mutate4ts']);
const SKIP_SUFFIXES = ['.d.ts', '.spec.ts', '.test.ts', '.spec.tsx', '.test.tsx'];

export function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) walk(full);
        continue;
      }
      if (SKIP_SUFFIXES.some((s) => entry.endsWith(s))) continue;
      if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
    }
  };
  walk(root);
  return out;
}
