// Copies the RERA ranges of one version into another as a starting point for the property managers
// (user decision 11-Oct-2026, audit FIN-014: 2026's 71 ranges into the 2027 budget). Ranges the target
// already has are kept. Recalculates the target's lines and writes one audit row per range copied.
//
// The 2026 workbook keyed its ranges by its own codes (2 = two bedrooms, S = studio, 0 / 100 / 101 / 102
// = commercial kinds, L = labour); the units now carry the lease report's codes (2BR, 2BR VILLA, OFFICE,
// SHOP …). With --workbook, each 2026 range is put on the codes the same units carry now, unit by unit
// from the workbook's Revenue Master (column H, the 2026 code, against the unit number).
//
//   $env:BUDGET_ACTOR = '<your email>'
//   npx tsx scripts/copy-rera.ts <fromVersionId> <toVersionId> [--workbook <H.E. MJN_Budget 2026.xlsm>] [--apply]
import 'dotenv/config';
import { scriptActor } from './script-actor';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { recalcLines } from '../src/lib/budget/calc';
import { parseRevenueMaster } from '../src/lib/import/budget2026';
import { propertyKey, unitKey } from '../src/lib/import/tenant-lease';

const norm = (s: string | null | undefined) => String(s ?? '').trim().toUpperCase();

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const wbPath = args.includes('--workbook') ? args[args.indexOf('--workbook') + 1] : null;
  const [from, to] = args.filter((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--workbook').map(Number);
  if (!from || !to) throw new Error('usage: copy-rera.ts <fromVersionId> <toVersionId> [--workbook <xlsm>] [--apply]');
  const [target] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, to));
  if (!target || target.status === 'LOCKED') throw new Error('The target version is locked or missing');
  const source = await db.select().from(schema.reraIndex).where(eq(schema.reraIndex.versionId, from));

  // the code each unit carries now
  const units = await db.select({ code: schema.units.unitCode, bedroom: schema.units.bedroom }).from(schema.units);
  const nowCode = new Map(units.map((u) => [unitKey(u.code), norm(u.bedroom)]));
  // property × 2026 code → the codes its units carry now
  const translate = new Map<string, Set<string>>();
  if (wbPath) {
    for (const l of parseRevenueMaster(XLSX.read(readFileSync(wbPath), { cellFormula: false }))) {
      const now = nowCode.get(unitKey(l.unitCode));
      if (!now || !l.bedroom) continue;
      const k = `${propertyKey(l.propertyCode)}|${norm(l.bedroom)}`;
      translate.set(k, (translate.get(k) ?? new Set()).add(now));
    }
  }
  const props = await db.select().from(schema.properties);
  const codeOfKey = new Map(props.map((p) => [propertyKey(p.code), p.code]));
  const have = new Set((await db.select().from(schema.reraIndex).where(eq(schema.reraIndex.versionId, to))).map((r) => `${norm(r.propertyCode)}|${norm(r.bedroom)}`));

  const planned: { propertyCode: string; bedroom: string; unitType: string | null; min: number; max: number; was: string }[] = [];
  const unmatched: string[] = [];
  for (const r of source) {
    const prop = codeOfKey.get(propertyKey(r.propertyCode)) ?? r.propertyCode;
    const codes = wbPath ? [...(translate.get(`${propertyKey(r.propertyCode)}|${norm(r.bedroom)}`) ?? [])] : [norm(r.bedroom)];
    if (!codes.length) unmatched.push(`${r.propertyCode} ${r.bedroom}`);
    for (const c of codes) {
      const key = `${norm(prop)}|${c}`;
      if (have.has(key) || planned.some((p) => `${norm(p.propertyCode)}|${p.bedroom}` === key)) continue;
      planned.push({ propertyCode: prop, bedroom: c, unitType: r.unitType, min: r.min, max: r.max, was: norm(r.bedroom) });
    }
  }
  console.log(`${source.length} ranges in version ${from}; ${have.size} already in version ${to}; ${planned.length} to add${wbPath ? ' (translated to the codes the units carry now)' : ''}`);
  for (const p of planned) console.log(`  ${p.propertyCode.padEnd(9)} ${p.was.padEnd(4)} → ${p.bedroom.padEnd(11)} ${p.min} – ${p.max}`);
  if (unmatched.length) console.log(`Not matched to any unit now (not copied): ${unmatched.join(', ')}`);
  if (!apply) return console.log('Dry run: add --apply to copy.');

  const actor = await scriptActor();
  const propId = new Map(props.map((p) => [norm(p.code), p.id]));
  await db.transaction(async (tx) => {
    for (const p of planned) {
      await tx.insert(schema.reraIndex).values({ versionId: to, propertyCode: p.propertyCode, bedroom: p.bedroom, unitType: p.unitType, min: p.min, max: p.max });
      await tx.insert(schema.auditLog).values({ userId: actor, versionId: to, propertyId: propId.get(norm(p.propertyCode)) ?? null, entity: 'rera_index', entityId: `${p.propertyCode}|${p.bedroom}`, action: 'copy', changes: { from: null, to: { min: p.min, max: p.max }, copiedFromVersion: from, code2026: p.was } });
    }
    await recalcLines(tx, to);
  });
  console.log(`Copied ${planned.length} ranges and recalculated version ${to}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
