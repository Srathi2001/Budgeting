import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db';

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
  warnings: number;
  revenue: number[];
  /** rent cheques ex VAT */
  cash: number[];
  vat: number[];
  depositIn: number[];
  depositOut: number[];
  /** Engine-derived other income by month (admin, ejari, MF, agency) */
  autoOther: { adminFee: number[]; ejariFee: number[]; mfFee: number[]; agencyFee: number[] };
  /** Manually budgeted other income by month, all GLs combined */
  manualOther: number[];
  vacancyLoss: number;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RETURNED';
}

const z12 = () => Array.from({ length: 12 }, () => 0);

/** Per-property monthly totals for a version, restricted to `propertyIds` when given. */
export async function propertyRollups(versionId: number, propertyIds?: number[]): Promise<PropertyRollup[]> {
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
      warnings: 0,
      revenue: z12(),
      cash: z12(),
      vat: z12(),
      depositIn: z12(),
      depositOut: z12(),
      autoOther: { adminFee: z12(), ejariFee: z12(), mfFee: z12(), agencyFee: z12() },
      manualOther: z12(),
      vacancyLoss: 0,
      status: r.status ?? 'DRAFT',
    });
  }

  const monthly = await db.execute(sql`
    select property_id, month,
      sum(revenue)::float as revenue, sum(cash)::float as cash,
      sum(admin_fee)::float as admin_fee, sum(ejari_fee)::float as ejari_fee,
      sum(mf_fee)::float as mf_fee, sum(agency_fee)::float as agency_fee,
      sum(vat)::float as vat, sum(deposit_in)::float as deposit_in, sum(deposit_out)::float as deposit_out
    from line_monthly where version_id = ${versionId}
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
    roll.autoOther.adminFee[i] = r.admin_fee;
    roll.autoOther.ejariFee[i] = r.ejari_fee;
    roll.autoOther.mfFee[i] = r.mf_fee;
    roll.autoOther.agencyFee[i] = r.agency_fee;
  }

  const lineStats = await db.execute(sql`
    select property_id, count(*)::int as units,
      count(*) filter (where vacant)::int as vacant,
      coalesce(sum(jsonb_array_length(coalesce(calc->'warnings','[]'::jsonb))),0)::int as warnings,
      coalesce(sum((calc->>'vacancyLoss')::float),0)::float as vacancy_loss
    from lease_lines where version_id = ${versionId} group by property_id`);
  for (const r of lineStats.rows as Record<string, number>[]) {
    const roll = map.get(r.property_id);
    if (!roll) continue;
    roll.units = r.units;
    roll.vacantUnits = r.vacant;
    roll.warnings = r.warnings;
    roll.vacancyLoss = r.vacancy_loss;
  }

  const oi = await db.select().from(schema.otherIncome).where(eq(schema.otherIncome.versionId, versionId));
  for (const o of oi) {
    const roll = map.get(o.propertyId);
    if (!roll) continue;
    o.months.forEach((v, i) => (roll.manualOther[i] += Number(v) || 0));
  }
  return [...map.values()];
}

export function autoOtherTotal(r: PropertyRollup): number[] {
  return r.revenue.map(
    (_, i) => r.autoOther.adminFee[i] + r.autoOther.ejariFee[i] + r.autoOther.mfFee[i] + r.autoOther.agencyFee[i],
  );
}

/**
 * Total cash inflow by month: rent cheques + lease fees + manual other income (assumed collected
 * in the month budgeted) + VAT + security deposits received - deposits refunded.
 */
export function cashFlow(r: PropertyRollup): number[] {
  const fees = autoOtherTotal(r);
  return r.revenue.map((_, i) => r.cash[i] + fees[i] + r.manualOther[i] + r.vat[i] + r.depositIn[i] - r.depositOut[i]);
}