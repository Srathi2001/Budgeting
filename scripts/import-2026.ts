// Seeds the database from the 2026 finance workbook and creates the 2027 budget version.
//
//   npm run db:import                (paths from .env: BUDGET_2026_XLSX, PM_TEMPLATES_DIR)
//   npm run db:import -- --reset     (drop all budget data first)
//
// Steps: business units, properties, units -> 2026 baseline version (locked, values exactly as
// in the workbook) -> RERA index from the PM templates -> other income, comparatives, comments
// -> users -> roll forward into an open 2027 version.

import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { db, schema } from '../src/db';
import {
  readWorkbook,
  parseRevenueMaster,
  parseCamps,
  parseRevenueAnalysis,
  normPropertyCode,
  type ParsedLease,
} from '../src/lib/import/budget2026';
import { formatDay } from '../src/lib/engine/dates';
import { recalcLines } from '../src/lib/budget/calc';
import { rollForward } from '../src/lib/budget/rollforward';

const BU_NAMES: Record<string, string> = { '501': 'REHL', '502': 'MJN', '522': 'PMC' };
const CAMP_CODES = new Set(['10B110N', '10B133N', '10B134N', '602A07N', '602A12N']);
const MALL_CODES = new Set(['10B131N']);

const t = schema;

async function reset() {
  await db.execute(sql`truncate table audit_log, submissions, property_notes, comparatives,
    rera_index, line_monthly, lease_lines, budget_versions, units, properties, business_units, users
    restart identity cascade`);
}

function parseRera(dir: string | undefined) {
  const out = new Map<string, { propertyCode: string; bedroom: string; unitType: string | null; min: number; max: number }>();
  if (!dir) return out;
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$'));
  } catch {
    console.warn(`  ! PM templates folder not readable: ${dir}`);
    return out;
  }
  for (const f of files) {
    const wb = XLSX.read(readFileSync(join(dir, f)), { type: 'buffer', sheets: ['RERA Index Range'] });
    const ws = wb.Sheets['RERA Index Range'];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
    for (const r of rows.slice(1)) {
      const code = r[2] ? String(r[2]).trim().toUpperCase() : null;
      const bedroom = r[3] !== null && r[3] !== undefined ? String(r[3]).trim().toUpperCase() : null;
      const toNum = (v: unknown) => (v === null || v === undefined ? NaN : Number(String(v).replace(/[, ]/g, '')));
      const min = toNum(r[20]);
      const max = toNum(r[21]);
      if (!code || bedroom === null || !Number.isFinite(min) || !Number.isFinite(max)) continue;
      const key = `${code}|${bedroom}`;
      if (!out.has(key)) out.set(key, { propertyCode: code, bedroom, unitType: r[4] ? String(r[4]).trim() : null, min, max });
    }
  }
  return out;
}

async function main() {
  const xlsxPath = process.env.BUDGET_2026_XLSX;
  if (!xlsxPath) throw new Error('Set BUDGET_2026_XLSX in .env');
  if (process.argv.includes('--reset')) {
    console.log('Resetting database…');
    await reset();
  }
  const existing = await db.select().from(t.budgetVersions);
  if (existing.length) throw new Error('Database already has budget versions. Re-run with --reset to start over.');

  console.log(`Reading ${xlsxPath}`);
  const wb = readWorkbook(readFileSync(xlsxPath));
  const leases: ParsedLease[] = [...parseRevenueMaster(wb), ...parseCamps(wb)];
  console.log(`  ${leases.length} lease rows`);

  // ---- business units, properties, units -----------------------------------------------
  const bus = [...new Set(leases.map((l) => l.buCode))];
  await db.insert(t.businessUnits).values(bus.map((code) => ({ code, name: BU_NAMES[code] ?? code })));

  const propMap = new Map<string, number>();
  for (const l of leases) {
    if (propMap.has(l.propertyCode)) continue;
    const [p] = await db
      .insert(t.properties)
      .values({
        code: l.propertyCode,
        name: l.propertyName,
        buCode: l.buCode,
        coordinator: l.coordinator,
        kind: CAMP_CODES.has(l.propertyCode) ? 'CAMP' : MALL_CODES.has(l.propertyCode) ? 'MALL' : 'BUILDING',
      })
      .returning();
    propMap.set(l.propertyCode, p.id);
  }
  console.log(`  ${propMap.size} properties`);

  const unitMap = new Map<string, number>();
  const seenUnits = new Set<string>();
  const dupes: string[] = [];
  for (const l of leases) {
    let code = l.unitCode;
    if (seenUnits.has(code)) {
      // duplicate unit codes in the workbook: keep both, suffix the second
      code = `${code}#${l.row}`;
      dupes.push(code);
    }
    seenUnits.add(code);
    l.unitCode = code;
  }
  for (let i = 0; i < leases.length; i += 500) {
    const chunk = leases.slice(i, i + 500);
    const inserted = await db
      .insert(t.units)
      .values(
        chunk.map((l) => ({
          propertyId: propMap.get(l.propertyCode)!,
          unitCode: l.unitCode,
          bedroom: l.bedroom,
          area: l.area,
          rc: l.rc,
          pivotCategory: l.pivotCategory,
          unitType: l.unitType,
          rooms: l.rooms === null ? null : Math.round(l.rooms),
          capacity: l.capacity === null ? null : Math.round(l.capacity),
        })),
      )
      .returning({ id: t.units.id, unitCode: t.units.unitCode });
    for (const u of inserted) unitMap.set(u.unitCode, u.id);
  }
  console.log(`  ${unitMap.size} units${dupes.length ? ` (${dupes.length} duplicate codes suffixed: ${dupes.join(', ')})` : ''}`);

  // ---- 2026 baseline version -------------------------------------------------------------
  const [v2026] = await db
    .insert(t.budgetVersions)
    .values({ year: 2026, name: '2026 Budget (imported)', status: 'LOCKED', isBaseline: true })
    .returning();

  const lines = leases.map((l) => ({
    versionId: v2026.id,
    unitId: unitMap.get(l.unitCode)!,
    propertyId: propMap.get(l.propertyCode)!,
    tenant: l.tenant,
    vacant: l.vacant,
    staffOwner: l.staffOwner,
    mfCurrent: l.mfCurrent,
    currentRent: l.currentRent,
    currentStart: formatDay(l.currentStart),
    currentEnd: formatDay(l.currentEnd),
    renew1: l.renew1,
    noRenewal: l.noRenewal,
    // the workbook holds the agreed renewal terms explicitly, so store them as overrides
    r1Rent: l.r1Rent ?? 0,
    r1Start: formatDay(l.r1Start),
    r1End: formatDay(l.r1End),
    r1Mf: l.r1Mf ?? false,
    r2Renew: l.r2Start ? true : false,
    r2Rent: l.r2Rent,
    r2Start: formatDay(l.r2Start),
    r2End: formatDay(l.r2End),
    r2Mf: l.r2Mf ?? false,
    // the workbook has no 3rd renewals
    r3Renew: false,
    notes: `Imported from ${l.source === 'CAMPS' ? 'Camps New' : 'Revenue Master'} row ${l.row}`,
  }));
  for (let i = 0; i < lines.length; i += 500) await db.insert(t.leaseLines).values(lines.slice(i, i + 500));
  console.log('  Calculating 2026…');
  await recalcLines(db, v2026.id);
  const [{ rev }] = (
    await db.execute(sql`select coalesce(sum(revenue),0)::float as rev from line_monthly where version_id = ${v2026.id}`)
  ).rows as { rev: number }[];
  const excelRev = leases.reduce((s, l) => s + l.excelRevenue.reduce((a, b) => a + b, 0), 0);
  console.log(`  2026 revenue: tool ${rev.toFixed(0)} vs workbook ${excelRev.toFixed(0)}`);

  // ---- RERA index ---------------------------------------------------------------------------
  const rera = parseRera(process.env.PM_TEMPLATES_DIR);
  if (rera.size) {
    await db.insert(t.reraIndex).values([...rera.values()].map((r) => ({ ...r, versionId: v2026.id })));
  }
  console.log(`  ${rera.size} RERA index rows`);

  const byNorm = new Map([...propMap.entries()].map(([code, id]) => [normPropertyCode(code), id]));

  // ---- comparatives & comments from Revenue Analysis ---------------------------------------
  const analysis = parseRevenueAnalysis(wb);
  const compRows: (typeof t.comparatives.$inferInsert)[] = [];
  const noteRows: (typeof t.propertyNotes.$inferInsert)[] = [];
  for (const a of analysis) {
    const pid = byNorm.get(normPropertyCode(a.propertyCode));
    if (!pid) {
      console.warn(`  ! Revenue Analysis property not found among units: ${a.propertyCode} ${a.propertyName}`);
      continue;
    }
    for (const [label, amount] of Object.entries(a.values)) {
      if (label !== '2026B') compRows.push({ versionId: v2026.id, propertyId: pid, label, amount });
    }
    noteRows.push({ versionId: v2026.id, propertyId: pid, comment: a.comment, vacancyLossOverride: a.vacancyLoss });
  }
  if (compRows.length) await db.insert(t.comparatives).values(compRows);
  if (noteRows.length) await db.insert(t.propertyNotes).values(noteRows);
  for (const p of propMap.values()) {
    await db.insert(t.submissions).values({ versionId: v2026.id, propertyId: p, status: 'APPROVED' });
  }

  // ---- users -----------------------------------------------------------------------------------
  // no default: every environment sets its own initial password (users change it on first sign-in)
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12) throw new Error('Set SEED_PASSWORD (12+ characters) before seeding users');
  const hash = await bcrypt.hash(password, 10);
  const coordinators = [...new Set(leases.map((l) => l.coordinator).filter(Boolean))] as string[];
  await db.insert(t.users).values([
    { email: 'admin@budget.local', name: 'Administrator', passwordHash: hash, role: 'ADMIN' },
    { email: 'finance@budget.local', name: 'Finance', passwordHash: hash, role: 'FINANCE' },
    { email: 'fmd@budget.local', name: 'Facilities Management', passwordHash: hash, role: 'FM' },
    ...coordinators.map((c) => ({
      email: `${c.toLowerCase()}@budget.local`,
      name: c.charAt(0) + c.slice(1).toLowerCase(),
      passwordHash: hash,
      role: 'PM' as const,
      coordinator: c,
    })),
  ]);
  console.log(`  users: admin, finance, fmd, ${coordinators.map((c) => c.toLowerCase()).join(', ')} @budget.local / password "${password}"`);

  // ---- roll forward to 2027 -----------------------------------------------------------------
  console.log('Rolling forward to 2027…');
  const v2027 = await rollForward(db, v2026.id, { name: '2027 Budget' });
  // the approved 2026 budget per Revenue Analysis is the official comparative
  for (const a of analysis) {
    const pid = byNorm.get(normPropertyCode(a.propertyCode));
    if (!pid || a.values['2026B'] === null) continue;
    await db
      .insert(t.comparatives)
      .values({ versionId: v2027.id, propertyId: pid, label: '2026B', amount: a.values['2026B'] })
      .onConflictDoUpdate({
        target: [t.comparatives.versionId, t.comparatives.propertyId, t.comparatives.label],
        set: { amount: a.values['2026B'] },
      });
  }
  const [{ rev27 }] = (
    await db.execute(sql`select coalesce(sum(revenue),0)::float as rev27 from line_monthly where version_id = ${v2027.id}`)
  ).rows as { rev27: number }[];
  console.log(`  2027 version #${v2027.id} created, starting revenue ${rev27.toFixed(0)}`);
  console.log('Done.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
