// Other income by property: charges billed with the current leases besides rent (maintenance fee,
// utility fee, additional car park), from the Oracle lease import. Kept apart from rent revenue.
import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';

export const FEE_TYPES = [
  { key: 'maintenance', label: 'Maintenance fee' },
  { key: 'utility', label: 'Utility fee' },
  { key: 'carPark', label: 'Additional car park' },
] as const;
export type FeeKey = (typeof FEE_TYPES)[number]['key'];

export interface OtherIncomeRow {
  propertyId: number;
  code: string;
  name: string;
  bu: string;
  pm: string;
  /** budget lines with a current lease */
  leases: number;
  /** annualised amount per fee, and how many leases carry it */
  fees: Record<FeeKey, { amount: number; leases: number }>;
  /** annualised rent of the leases that pay a maintenance fee (for the fee as % of rent) */
  rentWithMaintenance: number;
}

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000 + 1;

export async function loadOtherIncome(versionId: number, propertyIds: number[]): Promise<OtherIncomeRow[]> {
  const ids = propertyIds.length ? propertyIds : [-1];
  const rows = await db
    .select({ l: schema.leaseLines, p: schema.properties, bu: schema.businessUnits.name })
    .from(schema.leaseLines)
    .innerJoin(schema.properties, eq(schema.properties.id, schema.leaseLines.propertyId))
    .innerJoin(schema.businessUnits, eq(schema.businessUnits.code, schema.properties.buCode))
    .where(and(eq(schema.leaseLines.versionId, versionId), inArray(schema.leaseLines.propertyId, ids)));

  const byProp = new Map<number, OtherIncomeRow>();
  for (const { l, p, bu } of rows) {
    const r =
      byProp.get(p.id) ??
      ({
        propertyId: p.id,
        code: p.code,
        name: p.name,
        bu,
        pm: p.coordinator ?? '—',
        leases: 0,
        fees: { maintenance: { amount: 0, leases: 0 }, utility: { amount: 0, leases: 0 }, carPark: { amount: 0, leases: 0 } },
        rentWithMaintenance: 0,
      } satisfies OtherIncomeRow);
    byProp.set(p.id, r);
    if (!l.currentStart || !l.currentEnd) continue;
    r.leases++;
    // fees are billed per contract year like the rent: put them on a 12-month basis
    const perYear = 365 / Math.max(days(l.currentStart, l.currentEnd), 1);
    const add = (k: FeeKey, v: number | null) => {
      if (!v) return;
      r.fees[k].amount += v * perYear;
      r.fees[k].leases++;
    };
    add('maintenance', l.maintenanceFee);
    add('utility', l.utilityFee);
    add('carPark', l.carParkFee);
    if (l.maintenanceFee) r.rentWithMaintenance += (l.currentRent ?? 0) * perYear;
  }
  return [...byProp.values()].sort((a, b) => a.bu.localeCompare(b.bu) || a.code.localeCompare(b.code));
}
