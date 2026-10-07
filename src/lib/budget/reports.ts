import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { categoryOf, type Category } from './category';

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
