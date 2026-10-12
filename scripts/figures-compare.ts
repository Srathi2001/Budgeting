// Compares two folders written by scripts/figures.ts: lists every file whose content differs, with the
// first differences (path, before, after). Numbers count as equal within 1e-6. Exits with code 1 on a difference.
//
//   npx tsx scripts/figures-compare.ts <beforeDir> <afterDir> [--ignore <regex>]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [a, b, ...rest] = process.argv.slice(2);
if (!a || !b) throw new Error('Usage: tsx scripts/figures-compare.ts <beforeDir> <afterDir> [--ignore <regex>]');
const ignore = rest[0] === '--ignore' && rest[1] ? new RegExp(rest[1]) : null;

function diff(x: unknown, y: unknown, path: string, out: string[], limit = 8) {
  if (out.length >= limit) return;
  if (ignore?.test(path)) return;
  if (typeof x === 'number' && typeof y === 'number') {
    if (Math.abs(x - y) > 1e-6 * Math.max(1, Math.abs(x))) out.push(`${path}: ${x} -> ${y}`);
    return;
  }
  if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') {
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${path}: ${JSON.stringify(x)?.slice(0, 120)} -> ${JSON.stringify(y)?.slice(0, 120)}`);
    return;
  }
  if (Array.isArray(x) !== Array.isArray(y)) {
    out.push(`${path}: array/object mismatch`);
    return;
  }
  if (Array.isArray(x) && Array.isArray(y)) {
    if (x.length !== y.length) out.push(`${path}: length ${x.length} -> ${y.length}`);
    for (let i = 0; i < Math.min(x.length, y.length); i++) diff(x[i], y[i], `${path}[${i}]`, out, limit);
    return;
  }
  const xo = x as Record<string, unknown>;
  const yo = y as Record<string, unknown>;
  for (const k of new Set([...Object.keys(xo), ...Object.keys(yo)])) {
    if (ignore?.test(`${path}.${k}`)) continue;
    if (!(k in yo)) out.push(`${path}.${k}: removed`);
    else if (!(k in xo)) out.push(`${path}.${k}: added`);
    else diff(xo[k], yo[k], `${path}.${k}`, out, limit);
  }
}

let changed = 0;
const files = readdirSync(a).filter((f) => f.endsWith('.json') && f !== 'metrics.json');
for (const f of files) {
  if (!existsSync(join(b, f))) {
    console.log(`MISSING ${f}`);
    changed++;
    continue;
  }
  const out: string[] = [];
  diff(JSON.parse(readFileSync(join(a, f), 'utf8')), JSON.parse(readFileSync(join(b, f), 'utf8')), '$', out);
  if (out.length) {
    changed++;
    console.log(`DIFF ${f}`);
    for (const l of out) console.log(`  ${l}`);
  }
}
for (const f of readdirSync(b).filter((f) => f.endsWith('.json') && f !== 'metrics.json' && !files.includes(f))) console.log(`NEW ${f}`);

// round trips and time per file, before and after
type Metric = { file: string; queries: number; ms: number };
const m = (d: string): Metric[] => (existsSync(join(d, 'metrics.json')) ? JSON.parse(readFileSync(join(d, 'metrics.json'), 'utf8')) : []);
const ma = m(a);
const mb = new Map(m(b).map((x) => [x.file, x]));
const tot = (l: Metric[]) => l.reduce((s, x) => ({ q: s.q + x.queries, ms: s.ms + x.ms }), { q: 0, ms: 0 });
const ta = tot(ma);
const tb = tot([...mb.values()]);
console.log(`\n${files.length} files compared, ${changed} different`);
console.log(`round trips ${ta.q} -> ${tb.q}, time ${(ta.ms / 1000).toFixed(1)} s -> ${(tb.ms / 1000).toFixed(1)} s`);
if (process.argv.includes('--metrics'))
  for (const x of ma) {
    const y = mb.get(x.file);
    if (y) console.log(`  ${x.file.padEnd(60)} ${String(x.queries).padStart(5)} -> ${String(y.queries).padEnd(5)} ${String(x.ms).padStart(6)} -> ${y.ms} ms`);
  }
if (changed) process.exitCode = 1;
