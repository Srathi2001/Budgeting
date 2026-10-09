// Oracle "Revenue Recognition Summary" (Property Manager): rent revenue recognised per property and
// month for the accounting periods asked for, then Oracle's forecast from the signed leases for the
// forecast period. The accounted months are the revenue actuals (Revenue Analysis 20xxA and the
// actual part of the current-year forecast); Oracle's forecast months are kept for reference only.
// The remaining months of the current year are projected from the Lease Budget inputs instead.

import { and, eq, gte, inArray, lte, max } from 'drizzle-orm';
import { db, schema } from '@/db';
import { readTables } from './oracle-html';
import { propertyKey } from './tenant-lease';

const MON: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

export interface RrProperty {
  code: string;
  name: string;
  businessUnit: string;
  /** YYYY-MM → amount, accounted periods */
  actual: Record<string, number>;
  /** YYYY-MM → amount, Oracle's forecast period */
  forecast: Record<string, number>;
}

export interface RrReport {
  accountingPeriods: string | null;
  forecastPeriod: string | null;
  properties: RrProperty[];
  /** first and last accounted month */
  from: string | null;
  to: string | null;
}

const num = (v: unknown) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const monthOf = (h: string) => {
  const m = /^([A-Za-z]{3})-(\d{4})$/.exec(h.trim());
  return m && MON[m[1].toUpperCase()] ? `${m[2]}-${MON[m[1].toUpperCase()]}` : null;
};

export function parseRevenueRecognition(data: Buffer): RrReport {
  const tables = readTables(data);
  for (const t of tables) {
    const hi = t.rows.findIndex((r) => r.some((c) => String(c ?? '').trim() === 'Property Code'));
    if (hi < 0) continue;
    const h = t.rows[hi].map((c) => String(c ?? '').trim());
    const iCode = h.indexOf('Property Code');
    const iName = h.indexOf('Property Name');
    const iBu = h.indexOf('Business Unit');
    const iSplit = h.findIndex((x) => /^Accounted Period Total$/i.test(x));
    const months = h.map((x, i) => ({ month: monthOf(x), i })).filter((c): c is { month: string; i: number } => !!c.month);
    if (!months.length || iSplit < 0) throw new Error('No monthly columns ("Jan-2024" …) or "Accounted Period Total" column found');
    // parameters above the header
    const params = new Map<string, string>();
    for (const r of t.rows.slice(0, hi)) {
      for (let i = 0; i < r.length - 1; i++) {
        const k = String(r[i] ?? '').trim();
        const v = String(r[i + 1] ?? '').trim();
        // the band over the month columns repeats "Forecast Period" with no value: keep the first value
        if (/^(Accounting Periods|Forecast Period)$/i.test(k) && v && !params.has(k.toLowerCase())) params.set(k.toLowerCase(), v);
      }
    }
    const properties: RrProperty[] = [];
    for (const r of t.rows.slice(hi + 1)) {
      const code = String(r[iCode] ?? '').trim();
      if (!code) continue;
      const p: RrProperty = { code, name: String(r[iName] ?? '').trim(), businessUnit: String(r[iBu] ?? '').trim(), actual: {}, forecast: {} };
      for (const m of months) (m.i < iSplit ? p.actual : p.forecast)[m.month] = num(r[m.i]);
      properties.push(p);
    }
    const accounted = months.filter((m) => m.i < iSplit).map((m) => m.month).sort();
    return {
      accountingPeriods: params.get('accounting periods') ?? null,
      forecastPeriod: params.get('forecast period') ?? null,
      properties,
      from: accounted[0] ?? null,
      to: accounted.at(-1) ?? null,
    };
  }
  throw new Error('This does not look like the Revenue Recognition Summary (no "Property Code" header)');
}

export interface RrPreview {
  accountingPeriods: string | null;
  forecastPeriod: string | null;
  from: string | null;
  to: string | null;
  matched: number;
  /** actual revenue by calendar year, matched properties */
  years: { year: string; months: number; amount: number }[];
  oracleForecast: number;
  unmatched: { code: string; name: string; amount: number }[];
}

export async function planRevenueImport(report: RrReport) {
  const props = await db.select().from(schema.properties);
  const byKey = new Map(props.map((p) => [propertyKey(p.code), p]));
  const rows: (typeof schema.revenueActuals.$inferInsert)[] = [];
  const matched = new Set<number>();
  const unmatched: RrPreview['unmatched'] = [];
  const years = new Map<string, { months: Set<string>; amount: number }>();
  let oracleForecast = 0;
  for (const p of report.properties) {
    const prop = byKey.get(propertyKey(p.code));
    if (!prop) {
      unmatched.push({ code: p.code, name: p.name, amount: Math.round(Object.values(p.actual).reduce((s, v) => s + v, 0)) });
      continue;
    }
    matched.add(prop.id);
    for (const [month, amount] of Object.entries(p.actual)) {
      rows.push({ propertyId: prop.id, month, kind: 'A', amount: Math.round(amount * 100) / 100 });
      const y = years.get(month.slice(0, 4)) ?? { months: new Set<string>(), amount: 0 };
      y.months.add(month);
      y.amount += amount;
      years.set(month.slice(0, 4), y);
    }
    for (const [month, amount] of Object.entries(p.forecast)) {
      rows.push({ propertyId: prop.id, month, kind: 'F', amount: Math.round(amount * 100) / 100 });
      oracleForecast += amount;
    }
  }
  const preview: RrPreview = {
    accountingPeriods: report.accountingPeriods,
    forecastPeriod: report.forecastPeriod,
    from: report.from,
    to: report.to,
    matched: matched.size,
    years: [...years].sort().map(([year, y]) => ({ year, months: y.months.size, amount: Math.round(y.amount) })),
    oracleForecast: Math.round(oracleForecast),
    unmatched,
  };
  return { rows, propertyIds: [...matched], preview };
}

/**
 * The months an import replaces, per kind: accounted months only inside the report's own period
 * (so a Jan–Sep report never removes earlier years' actuals), Oracle's forecast as a whole (it is
 * reference only and the newest report supersedes it).
 */
export function replaceWindow(rows: { month: string; kind: string }[]): { actual: { from: string; to: string } | null; forecast: boolean } {
  const actual = rows.filter((r) => r.kind === 'A').map((r) => r.month).sort();
  return { actual: actual.length ? { from: actual[0], to: actual[actual.length - 1] } : null, forecast: rows.some((r) => r.kind === 'F') };
}

/** Replaces the revenue actuals of the properties in the report, for the months the report covers. */
export async function applyRevenueImport(report: RrReport, userId: number | null, file: string | null) {
  const { rows, propertyIds, preview } = await planRevenueImport(report);
  if (!rows.length) throw new Error('No property in the report matches the budget');
  const window = replaceWindow(rows);
  await db.transaction(async (tx) => {
    const a = schema.revenueActuals;
    if (window.actual) {
      await tx.delete(a).where(and(inArray(a.propertyId, propertyIds), eq(a.kind, 'A'), gte(a.month, window.actual.from), lte(a.month, window.actual.to)));
    }
    if (window.forecast) await tx.delete(a).where(and(inArray(a.propertyId, propertyIds), eq(a.kind, 'F')));
    for (let i = 0; i < rows.length; i += 500) await tx.insert(schema.revenueActuals).values(rows.slice(i, i + 500));
    await tx.insert(schema.auditLog).values({
      userId,
      entity: 'revenue_import',
      action: 'revenue_recognition_summary',
      changes: { file, accountingPeriods: preview.accountingPeriods, forecastPeriod: preview.forecastPeriod, properties: preview.matched, years: preview.years, replaced: window },
    });
  });
  return preview;
}

/** Last accounted month in the revenue actuals (the cut-off between actual and projected months). */
export async function lastActualMonth(): Promise<string | null> {
  const [r] = await db.select({ m: max(schema.revenueActuals.month) }).from(schema.revenueActuals).where(eq(schema.revenueActuals.kind, 'A'));
  return r?.m ?? null;
}
