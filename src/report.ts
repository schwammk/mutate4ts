export interface MutantResult {
  id: string;
  rule: string;
  file: string;
  name: string;
  startLine: number;
  status: 'KILLED' | 'SURVIVED' | 'NOT-COVERED';
  seconds: number | null;
}

const ORDER: Record<MutantResult['status'], number> = {
  SURVIVED: 0,
  'NOT-COVERED': 1,
  KILLED: 2,
};

export function renderText(results: MutantResult[]): string {
  if (results.length === 0) return '';
  const sorted = [...results].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || a.id.localeCompare(b.id),
  );
  const rows = sorted.map((r) => {
    const where = `${r.file}:${r.startLine}`;
    const time = r.seconds === null ? '-' : `${r.seconds.toFixed(1)}s`;
    return `${r.id}  ${r.rule}    ${r.name}    ${where}    ${r.status}    ${time}`;
  });
  const counts = (status: MutantResult['status']) => results.filter((r) => r.status === status).length;
  rows.push(
    `killed: ${counts('KILLED')}  survived: ${counts('SURVIVED')}  not-covered: ${counts('NOT-COVERED')}`,
  );
  return `${rows.join('\n')}\n`;
}

export function renderJson(results: MutantResult[]): string {
  const rows = results.map((r) => ({
    id: r.id,
    rule: r.rule,
    file: r.file,
    name: r.name,
    line: r.startLine,
    status: r.status,
    seconds: r.seconds,
  }));
  return `${JSON.stringify(rows, null, 2)}\n`;
}
