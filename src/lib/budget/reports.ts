import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { categoryOf, type Category } from './category';
import { OI_ACCOUNT, OI_ACCOUNTS } from './other-income-types';
import { withDefaults } from '@/lib/engine/assumptions';
import { landlordRent } from './admin';
import { PMA_FEE } from './group';

export interface PropertyRollup {
  propertyId: number;
  code: string;
  name: string;
  buCode: string;
  buName: string;
  coordinator: string | null;
  kind: 'BUILDING' | 'CAMP' | 'MALL';
  units: number;
  vacantUnits: number;
  /** units with a current lease from Fusion */
  leasedUnits: number;
  warnings: number;
  revenue: number[];
  /** rent cheques ex VAT */
  cash: number[];
  vat: number[];
  depositIn: number[];
  depositOut: number[];
  vacancyLoss: number;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RETURNED';
}

const z12 = () => Array.from({ length: 12 }, () => 0);

/** Lease lines of a version whose units are in `categories` (the Category page filter). */
async function linesInCategories(versionId: number, categories: Category[]): Promise<number[]> {
  const rows = await db
    .select({ id: schema.leaseLines.id, kind: schema.properties.kind, pivotCategory: schema.units.pivotCategory, unitType: schema.units.unitType, rc: schema.units.rc })
    .from(schema.leaseLines)
    .innerJoin(schema.units, eq(schema.units.id, schema.leaseLines.unitId))
    .innerJoin(schema.properties, eq(schema.properties.id, schema.leaseLines.propertyId))
    .where(eq(schema.leaseLines.versionId, versionId));
  return rows.filter((r) => categories.includes(categoryOf(r, r.kind))).map((r) => r.id);
}

/**
 * Per-property monthly totals for a version, restricted to `propertyIds` when given. With
 * `categories`, only units in those categories count (a mixed property shows its matching part).
 */
export async function propertyRollups(versionId: number, propertyIds?: number[], categories: Category[] = []): Promise<PropertyRollup[]> {
  const lineIds = categories.length ? await linesInCategories(versionId, categories) : null;
  const onLines = (col: string) => (lineIds ? sql` and ${sql.raw(col)} = any(${`{${lineIds.join(',') || '-1'}}`}::int[])` : sql``);
  const p = schema.properties;
  const props = await db
    .select({
      id: p.id,
      code: p.code,
      name: p.name,
      buCode: p.buCode,
      buName: schema.businessUnits.name,
      coordinator: p.coordinator,
      kind: p.kind,
      status: schema.submissions.status,
    })
    .from(p)
    .innerJoin(schema.businessUnits, eq(schema.businessUnits.code, p.buCode))
    .leftJoin(schema.submissions, and(eq(schema.submissions.propertyId, p.id), eq(schema.submissions.versionId, versionId)))
    .where(propertyIds ? inArray(p.id, propertyIds.length ? propertyIds : [-1]) : eq(p.active, true))
    .orderBy(p.buCode, p.code);

  const map = new Map<number, PropertyRollup>();
  for (const r of props) {
    map.set(r.id, {
      propertyId: r.id,
      code: r.code,
      name: r.name,
      buCode: r.buCode,
      buName: r.buName,
      coordinator: r.coordinator,
      kind: r.kind,
      units: 0,
      vacantUnits: 0,
      leasedUnits: 0,
      warnings: 0,
      revenue: z12(),
      cash: z12(),
      vat: z12(),
      depositIn: z12(),
      depositOut: z12(),
      vacancyLoss: 0,
      status: r.status ?? 'DRAFT',
    });
  }

  const monthly = await db.execute(sql`
    select property_id, month,
      sum(revenue)::float as revenue, sum(cash)::float as cash,
      sum(vat)::float as vat, sum(deposit_in)::float as deposit_in, sum(deposit_out)::float as deposit_out
    from line_monthly where version_id = ${versionId}${onLines('line_id')}
    group by property_id, month`);
  for (const r of monthly.rows as Record<string, number>[]) {
    const roll = map.get(r.property_id);
    if (!roll) continue;
    const i = r.month - 1;
    roll.revenue[i] = r.revenue;
    roll.cash[i] = r.cash;
    roll.vat[i] = r.vat;
    roll.depositIn[i] = r.deposit_in;
    roll.depositOut[i] = r.deposit_out;
  }

  const lineStats = await db.execute(sql`
    select property_id, count(*)::int as units,
      count(*) filter (where vacant)::int as vacant,
      count(*) filter (where current_end is not null)::int as leased,
      coalesce(sum(jsonb_array_length(coalesce(calc->'warnings','[]'::jsonb))),0)::int as warnings,
      coalesce(sum((calc->>'vacancyLoss')::float),0)::float as vacancy_loss
    from lease_lines where version_id = ${versionId}${onLines('id')} group by property_id`);
  for (const r of lineStats.rows as Record<string, number>[]) {
    const roll = map.get(r.property_id);
    if (!roll) continue;
    roll.units = r.units;
    roll.vacantUnits = r.vacant;
    roll.leasedUnits = r.leased;
    roll.warnings = r.warnings;
    roll.vacancyLoss = r.vacancy_loss;
  }
  // with a category filter, properties with no unit in it drop out
  return [...map.values()].filter((r) => !lineIds || r.units > 0);
}

/** Total cash inflow by month: rent cheques + VAT + security deposits received - deposits refunded. */
export function cashFlow(r: PropertyRollup): number[] {
  return r.revenue.map((_, i) => r.cash[i] + r.vat[i] + r.depositIn[i] - r.depositOut[i]);
}

/** Budget-year other income of one Other Income row (property or General) and account, by month. */
export interface OiMonthly {
  scope: string;
  buCode: string;
  propertyId: number | null;
  propertyCode: string | null;
  account: string;
  months: number[];
}

/**
 * Budget-year other income by row, GL account and month, as on the Other Income tab: the maintenance
 * service fee of properties from the lease calculation (in the month each contract starts), every
 * other budget amount spread evenly over 12 months. Property rows of `propertyIds` (with `categories`,
 * the fee of matching units only); General rows of the business units `generalBus` allows.
 */
export async function otherIncomeMonthly(
  versionId: number,
  propertyIds: number[],
  categories: Category[],
  generalBus: (buCode: string) => boolean,
): Promise<OiMonthly[]> {
  const props = new Map((await db.select({ id: schema.properties.id, code: schema.properties.code, buCode: schema.properties.buCode }).from(schema.properties)).map((p) => [p.id, p]));
  const out = new Map<string, OiMonthly>();
  const add = (scope: string, buCode: string, propertyId: number | null, account: string, i: number, v: number) => {
    const k = `${scope}|${account}`;
    const r = out.get(k) ?? { scope, buCode, propertyId, propertyCode: propertyId === null ? null : (props.get(propertyId)?.code ?? null), account, months: z12() };
    r.months[i] += v;
    out.set(k, r);
  };

  const stored = await db
    .select({ scope: schema.otherIncome.scope, buCode: schema.otherIncome.buCode, propertyId: schema.otherIncome.propertyId, account: schema.otherIncome.account, amount: schema.otherIncome.amount })
    .from(schema.otherIncome)
    .where(and(eq(schema.otherIncome.versionId, versionId), eq(schema.otherIncome.period, 'B')));
  const ids = new Set(propertyIds);
  for (const r of stored) {
    const acct = OI_ACCOUNT.get(r.account);
    if (!acct || !r.amount) continue;
    if (r.propertyId !== null ? !ids.has(r.propertyId) || acct.calc === 'MF' : !generalBus(r.buCode)) continue;
    if (r.scope === PMA_FEE.scope && r.account === PMA_FEE.account) continue; // calculated below
    for (let i = 0; i < 12; i++) add(r.scope, r.buCode, r.propertyId, r.account, i, Number(r.amount) / 12);
  }

  // ANPM's PMA fee: the PMA rate × the landlords' budget rent, by month
  if (generalBus('521')) {
    const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
    const rate = withDefaults(version?.assumptions).pmaRate;
    const rent = await landlordRent(versionId);
    rent.forEach((v, i) => v && add(PMA_FEE.scope, '521', null, PMA_FEE.account, i, v * rate));
  }

  const mfAccount = OI_ACCOUNTS.find((a) => a.calc === 'MF')!.code;
  if (propertyIds.length) {
    const lineIds = categories.length ? await linesInCategories(versionId, categories) : null;
    const mf = await db.execute(sql`
      select l.property_id, e.ord::int as month, sum(e.v::float)::float as amount
      from lease_lines l, jsonb_array_elements_text(coalesce(l.calc->'maintenance', '[]'::jsonb)) with ordinality e(v, ord)
      where l.version_id = ${versionId} and l.property_id = any(${`{${propertyIds.join(',')}}`}::int[])
        ${lineIds ? sql`and l.id = any(${`{${lineIds.join(',') || '-1'}}`}::int[])` : sql``}
      group by 1, 2`);
    for (const r of mf.rows as { property_id: number; month: number; amount: number }[]) {
      const p = props.get(r.property_id);
      if (p && r.month >= 1 && r.month <= 12 && r.amount) add(`P:${p.id}`, p.buCode, p.id, mfAccount, r.month - 1, r.amount);
    }
  }
  return [...out.values()];
}
