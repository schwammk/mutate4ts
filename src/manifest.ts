import { createHash } from 'node:crypto';
import { Unit, unitHash, RULE_VERSION } from './units.js';

export interface ManifestFunction {
  name: string;
  startLine: number;
  endLine: number;
  sha256: string;
  mutations: number;
}

export interface Manifest {
  date: string;
  ruleVersion: number;
  testProfile: string;
  functions: ManifestFunction[];
}

const MARKER = 'mutate4ts-manifest v1';

export function testProfile(testCommand: string): string {
  return createHash('sha256').update(testCommand).digest('hex');
}

export function parseManifest(sourceText: string): Manifest | null {
  const start = sourceText.lastIndexOf(MARKER);
  if (start === -1) return null;
  const blockStart = sourceText.lastIndexOf('/*', start);
  const blockEnd = sourceText.indexOf('*/', start);
  if (blockStart === -1 || blockEnd === -1) return null;
  const body = sourceText.slice(blockStart, blockEnd + 2);
  const field = (name: string): string => {
    const m = body.match(new RegExp(`\\* ${name}: (.*)`));
    if (!m) throw new Error(`malformed manifest: missing ${name}`);
    return m[1].trim();
  };
  const functionsRaw = body.match(/\* functions: \[([\s\S]*)\]/);
  if (!functionsRaw) throw new Error('malformed manifest: missing functions');
  const functions = JSON.parse(`[${functionsRaw[1].replace(/^\s*\*\s?/gm, '').trim().replace(/,\s*$/, '')}]`) as ManifestFunction[];
  return {
    date: field('date'),
    ruleVersion: Number(field('rule-version')),
    testProfile: field('test-profile'),
    functions,
  };
}

export function buildManifestBlock(manifest: Manifest): string {
  const lines: string[] = [];
  lines.push('/*');
  lines.push(` * ${MARKER}`);
  lines.push(` * date: ${manifest.date}`);
  lines.push(` * rule-version: ${manifest.ruleVersion}`);
  lines.push(` * test-profile: ${manifest.testProfile}`);
  lines.push(' * functions: [');
  for (const f of manifest.functions) {
    lines.push(` *   ${JSON.stringify(f)},`);
  }
  lines.push(' * ]');
  lines.push(' */');
  return `${lines.join('\n')}\n`;
}

export function appendManifest(sourceText: string, manifest: Manifest): string {
  const base = sourceText.endsWith('\n') ? sourceText : `${sourceText}\n`;
  return `${base}\n${buildManifestBlock(manifest)}`;
}

export function selectChanged(units: Unit[], manifest: Manifest | null, currentTestProfile: string): Unit[] {
  if (!manifest) return units;
  if (manifest.ruleVersion !== RULE_VERSION || manifest.testProfile !== currentTestProfile) return units;
  const certified = new Map(manifest.functions.map((f) => [`${f.name}|${f.startLine}`, f]));
  return units.filter((u) => {
    const entry = certified.get(`${u.name}|${u.startLine}`);
    return !entry || entry.sha256 !== unitHash(u.node);
  });
}
