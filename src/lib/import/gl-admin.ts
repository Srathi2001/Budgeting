// G&A actuals from the GL (Account Analysis Report, ledger MJN HOLDING), read with the other income
// upload: payroll and admin overhead accounts by company, department (cost centre) and month, debit −
// credit. Lines on a building whose account is a building overhead belong to Building Overheads and are
// left out; the salary allocation (63112) is kept to show what moved to the buildings. An import
// replaces the G&A actuals of the months the report covers.
import { and, gte, lte } from 'drizzle-orm';
import { db, schema, type DB } from '@/db';

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0] | DB;
import { ADMIN_ACCOUNT, SALARY_ALLOCATION, isPayrollAccount } from '@/lib/budget/admin-types';
import { isBohNatural } from '@/lib/budget/boh-types';
import { glSegments, type GlScan } from './gl-analysis';

export const ADMIN_LEDGER = 'MJN HOLDING';
const isAdminNatural = (n: string) => ADMIN_ACCOUNT.has(n) || n === SALARY_ALLOCATION;
export const isAdminAccount = (account: string) => isAdminNatural(glSegments(account).natural);

export interface AdminActual {
  company: string;
  dept: string;
  account: string;
  month: string;
  amount: number;
}
export interface AdminActualsPreview {
  from: string;
  to: string;
  rows: number;
  byYear: { year: string; payroll: number; admin: number; allocation: number }[];
}

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const monthOf = (p: string | null) => {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(p?.trim() ?? '');
  return m ? `20${m[2]}-${String(MON.indexOf(m[1].toUpperCase()) + 1).padStart(2, '0')}` : null;
};

export async function planAdminActuals(scan: GlScan): Promise<{ rows: AdminActual[]; preview: AdminActualsPreview } | null> {
  if (scan.ledger?.trim().toUpperCase() !== ADMIN_LEDGER) return null;
  const from = monthOf(scan.periodFrom);
  const to = monthOf(scan.periodTo);
  if (!from || !to) return null;
  const agg = new Map<string, AdminActual>();
  const years = new Map<string, { year: string; payroll: number; admin: number; allocation: number }>();
  for (const m of scan.months) {
    const g = glSegments(m.account);
    if (!isAdminNatural(g.natural)) continue;
    // a building overhead booked on a building is in Building Overheads
    if (g.property && g.property !== '000000' && isBohNatural(g.natural)) continue;
    const amount = m.debit - m.credit;
    if (!amount) continue;
    const dept = g.costCentre || '000';
    const k = `${g.company}|${dept}|${g.natural}|${m.month}`;
    const e = agg.get(k) ?? { company: g.company, dept, account: g.natural, month: m.month, amount: 0 };
    e.amount += amount;
    agg.set(k, e);
    const y = years.get(m.month.slice(0, 4)) ?? { year: m.month.slice(0, 4), payroll: 0, admin: 0, allocation: 0 };
    if (g.natural === SALARY_ALLOCATION) y.allocation += amount;
    else if (isPayrollAccount(g.natural)) y.payroll += amount;
    else y.admin += amount;
    years.set(y.year, y);
  }
  const rows = [...agg.values()].map((r) => ({ ...r, amount: Math.round(r.amount * 100) / 100 })).filter((r) => r.amount !== 0);
  const r0 = (n: number) => Math.round(n);
  return {
    rows,
    preview: {
      from,
      to,
      rows: rows.length,
      byYear: [...years.values()].sort((a, b) => a.year.localeCompare(b.year)).map((y) => ({ year: y.year, payroll: r0(y.payroll), admin: r0(y.admin), allocation: r0(y.allocation) })),
    },
  };
}

/** Replaces the G&A actuals of the months `preview` covers. */
export async function applyAdminActuals(rows: AdminActual[], preview: AdminActualsPreview, userId: number | null, file: string | null, on: Tx = db) {
  const run = async (tx: Tx) => {
    await tx.delete(schema.adminActuals).where(and(gte(schema.adminActuals.month, preview.from), lte(schema.adminActuals.month, preview.to)));
    for (let i = 0; i < rows.length; i += 500) await tx.insert(schema.adminActuals).values(rows.slice(i, i + 500));
    await tx.insert(schema.auditLog).values({ userId, entity: 'gl_import', action: 'admin_actuals', changes: { file, from: preview.from, to: preview.to, rows: rows.length, byYear: preview.byYear } });
  };
  if (on === db) await db.transaction(run);
  else await run(on);
}
