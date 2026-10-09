// Building overhead actuals from the GL (Account Analysis Report, ledger MJN HOLDING), read with the
// other income upload: the accounts in the building overhead list, debit − credit, by building and
// month. Lines without a building (property 000000) are company G&A, not building overheads, and are
// not kept. An import replaces the building overhead actuals of the months the report covers.
import { and, gte, lte } from 'drizzle-orm';
import { db, schema, type DB } from '@/db';

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0] | DB;
import { BOH_ACCOUNT, BOH_LINE_LABEL, BOH_LINES, isBohNatural } from '@/lib/budget/boh-types';
import { glSegments, type GlScan } from './gl-analysis';
import { propertyKey } from './tenant-lease';

export const BOH_LEDGER = 'MJN HOLDING';
export const isBohAccount = (account: string) => isBohNatural(glSegments(account).natural);

export interface BohActual {
  company: string;
  propertyId: number;
  account: string;
  month: string;
  amount: number;
}
export interface BohActualsPreview {
  from: string;
  to: string;
  rows: number;
  /** year × Building P&L line */
  byYear: { year: string; lines: Record<string, number>; total: number }[];
  /** buildings in the GL that are not in the budget */
  unmatched: { segment: string; amount: number }[];
  /** company-level lines (G&A), left out */
  companyLevel: number;
}

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const monthOf = (p: string | null) => {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(p?.trim() ?? '');
  return m ? `20${m[2]}-${String(MON.indexOf(m[1].toUpperCase()) + 1).padStart(2, '0')}` : null;
};

export async function planBohActuals(scan: GlScan): Promise<{ rows: BohActual[]; preview: BohActualsPreview } | null> {
  if (scan.ledger?.trim().toUpperCase() !== BOH_LEDGER) return null;
  const from = monthOf(scan.periodFrom);
  const to = monthOf(scan.periodTo);
  if (!from || !to) return null;
  const props = await db.select().from(schema.properties);
  const byKey = new Map(props.map((p) => [propertyKey(p.code), p]));
  const agg = new Map<string, BohActual>();
  const unmatched = new Map<string, number>();
  const years = new Map<string, Record<string, number>>();
  let companyLevel = 0;
  for (const m of scan.months) {
    if (!isBohAccount(m.account)) continue;
    const g = glSegments(m.account);
    const amount = m.debit - m.credit;
    if (!amount) continue;
    if (!g.property || g.property === '000000') {
      companyLevel += amount;
      continue;
    }
    const prop = byKey.get(propertyKey(g.property));
    if (!prop) {
      unmatched.set(g.property, (unmatched.get(g.property) ?? 0) + amount);
      continue;
    }
    const k = `${g.company}|${prop.id}|${g.natural}|${m.month}`;
    const e = agg.get(k) ?? { company: g.company, propertyId: prop.id, account: g.natural, month: m.month, amount: 0 };
    e.amount += amount;
    agg.set(k, e);
    const y = years.get(m.month.slice(0, 4)) ?? {};
    const line = BOH_ACCOUNT.get(g.natural)!.line;
    y[line] = (y[line] ?? 0) + amount;
    years.set(m.month.slice(0, 4), y);
  }
  const rows = [...agg.values()].map((r) => ({ ...r, amount: Math.round(r.amount * 100) / 100 })).filter((r) => r.amount !== 0);
  const r0 = (n: number) => Math.round(n);
  return {
    rows,
    preview: {
      from,
      to,
      rows: rows.length,
      byYear: [...years.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([year, l]) => ({
          year,
          lines: Object.fromEntries(BOH_LINES.map((x) => [BOH_LINE_LABEL[x.key], r0(l[x.key] ?? 0)])),
          total: r0(Object.values(l).reduce((s, v) => s + v, 0)),
        })),
      unmatched: [...unmatched].map(([segment, amount]) => ({ segment, amount: r0(amount) })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
      companyLevel: r0(companyLevel),
    },
  };
}

/** Replaces the building overhead actuals of the months `preview` covers. */
export async function applyBohActuals(rows: BohActual[], preview: BohActualsPreview, userId: number | null, file: string | null, on: Tx = db) {
  const run = async (tx: Tx) => {
    await tx.delete(schema.bohActuals).where(and(gte(schema.bohActuals.month, preview.from), lte(schema.bohActuals.month, preview.to)));
    for (let i = 0; i < rows.length; i += 500) await tx.insert(schema.bohActuals).values(rows.slice(i, i + 500));
    await tx.insert(schema.auditLog).values({ userId, entity: 'gl_import', action: 'boh_actuals', changes: { file, from: preview.from, to: preview.to, rows: rows.length, byYear: preview.byYear } });
  };
  if (on === db) await db.transaction(run);
  else await run(on);
}
