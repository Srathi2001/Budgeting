import { and, eq, inArray } from 'drizzle-orm';
import { type DB, schema } from '@/db';
import {
  computeLease,
  cashFlowOf,
  type Cheque,
  type LeaseInput,
  type LeaseResult,
  type MonthlySeries,
  type ReraRange,
} from '@/lib/engine/lease';
import { withDefaults } from '@/lib/engine/assumptions';
import { parseDay } from '@/lib/engine/dates';

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0] | DB;

const { leaseLines, units, properties, budgetVersions, reraIndex, lineMonthly } = schema;

export function reraKey(propertyCode: string, bedroom: string | null) {
  return `${propertyCode.trim().toUpperCase()}|${String(bedroom ?? '').trim().toUpperCase()}`;
}

function toCheques(items: schema.ScheduleItem[] | null): Cheque[] | null {
  if (!items?.length) return null;
  const out = items
    .map((i) => ({ date: parseDay(i.date), amount: Number(i.amount) || 0 }))
    .filter((i): i is Cheque => i.date !== null);
  return out.length ? out : null;
}

export function lineToInput(
  line: schema.LeaseLine,
  unit: schema.Unit,
  property: schema.Property,
): LeaseInput {
  return {
    rc: (unit.rc as LeaseInput['rc']) ?? 'R',
    isCamp: property.kind === 'CAMP',
    area: unit.area,
    capacity: unit.capacity,
    staffOwner: (line.staffOwner as LeaseInput['staffOwner']) ?? null,
    mfCurrent: line.mfCurrent,
    currentRent: line.currentRent,
    currentStart: parseDay(line.currentStart),
    currentEnd: parseDay(line.currentEnd),
    currentSchedule: toCheques(line.currentSchedule),
    securityDeposit: line.securityDeposit,
    renew1: line.renew1,
    noRenewal: line.noRenewal,
    r1Rent: line.r1Rent,
    r1Start: parseDay(line.r1Start),
    r1End: parseDay(line.r1End),
    r1Mf: line.r1Mf,
    r1Schedule: toCheques(line.r1Schedule),
    r2Renew: line.r2Renew,
    r2Rent: line.r2Rent,
    r2Start: parseDay(line.r2Start),
    r2End: parseDay(line.r2End),
    r2Mf: line.r2Mf,
    r2Schedule: toCheques(line.r2Schedule),
    budgetRate: line.budgetRate,
    increasePctOverride: line.increasePctOverride,
    cheques: line.cheques,
  };
}

/** Stored in lease_lines.calc — the engine result minus the monthly arrays (those live in line_monthly). */
export type StoredCalc = Omit<LeaseResult, keyof MonthlySeries> & {
  revenue: number[];
  /** rent cheques ex VAT */
  cash: number[];
  /** total cash inflow: rent + fees + VAT + deposits in - deposits out */
  cashFlow: number[];
};

/**
 * Recompute lines of a version (all lines, or only `lineIds`) and persist the results.
 * Returns the results keyed by line id.
 */
export async function recalcLines(tx: Tx, versionId: number, lineIds?: number[]) {
  const [version] = await tx.select().from(budgetVersions).where(eq(budgetVersions.id, versionId));
  if (!version) throw new Error(`Version ${versionId} not found`);
  const assumptions = withDefaults(version.assumptions);

  const where = lineIds?.length
    ? and(eq(leaseLines.versionId, versionId), inArray(leaseLines.id, lineIds))
    : eq(leaseLines.versionId, versionId);
  const rows = await tx
    .select({ line: leaseLines, unit: units, property: properties })
    .from(leaseLines)
    .innerJoin(units, eq(units.id, leaseLines.unitId))
    .innerJoin(properties, eq(properties.id, leaseLines.propertyId))
    .where(where);
  if (!rows.length) return new Map<number, LeaseResult>();

  const rera = new Map<string, ReraRange>();
  for (const r of await tx.select().from(reraIndex).where(eq(reraIndex.versionId, versionId))) {
    rera.set(reraKey(r.propertyCode, r.bedroom), { min: r.min, max: r.max });
  }

  const results = new Map<number, LeaseResult>();
  const monthly: (typeof lineMonthly.$inferInsert)[] = [];
  for (const { line, unit, property } of rows) {
    const res = computeLease(
      lineToInput(line, unit, property),
      version.year,
      assumptions,
      rera.get(reraKey(property.code, unit.bedroom)) ?? null,
    );
    results.set(line.id, res);
    for (let m = 0; m < 12; m++) {
      monthly.push({
        lineId: line.id,
        versionId,
        propertyId: line.propertyId,
        month: m + 1,
        revenue: res.revenue[m],
        cash: res.cash[m],
        adminFee: res.adminFee[m],
        ejariFee: res.ejariFee[m],
        mfFee: res.mfFee[m],
        agencyFee: res.agencyFee[m],
        vat: res.vat[m],
        depositIn: res.depositIn[m],
        depositOut: res.depositOut[m],
      });
    }
  }

  const ids = [...results.keys()];
  for (let i = 0; i < ids.length; i += 1000) {
    await tx.delete(lineMonthly).where(inArray(lineMonthly.lineId, ids.slice(i, i + 1000)));
  }
  for (let i = 0; i < monthly.length; i += 2000) {
    await tx.insert(lineMonthly).values(monthly.slice(i, i + 2000));
  }
  for (const [id, res] of results) {
    const stored: StoredCalc = {
      contracts: res.contracts,
      increasePct: res.increasePct,
      reraGap: res.reraGap,
      reraAverage: res.reraAverage,
      vacancyLoss: res.vacancyLoss,
      totals: res.totals,
      warnings: res.warnings,
      revenue: res.revenue,
      cash: res.cash,
      cashFlow: res.revenue.map((_, i) => Math.round(cashFlowOf(res, i) * 100) / 100),
    };
    await tx.update(leaseLines).set({ calc: stored }).where(eq(leaseLines.id, id));
  }
  return results;
}
