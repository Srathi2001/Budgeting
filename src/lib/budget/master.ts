import { and, eq, inArray, asc } from 'drizzle-orm';
import { db, schema } from '@/db';
import { formatDay } from '@/lib/engine/dates';
import type { Contract } from '@/lib/engine/lease';
import type { StoredCalc } from './calc';
import type { DerivedContract, MasterRow } from './master-types';

const { leaseLines, units, properties } = schema;

function toDerived(c: Contract | undefined): DerivedContract | null {
  if (!c) return null;
  return { rent: c.rent, start: formatDay(c.start), end: formatDay(c.end), mf: c.mf };
}

export async function loadMasterRows(
  versionId: number,
  opts: { propertyIds?: number[]; lineIds?: number[]; editableProperties?: Set<number> } = {},
): Promise<MasterRow[]> {
  const conds = [eq(leaseLines.versionId, versionId)];
  if (opts.propertyIds) conds.push(inArray(leaseLines.propertyId, opts.propertyIds.length ? opts.propertyIds : [-1]));
  if (opts.lineIds) conds.push(inArray(leaseLines.id, opts.lineIds.length ? opts.lineIds : [-1]));
  const rows = await db
    .select({ l: leaseLines, u: units, p: properties })
    .from(leaseLines)
    .innerJoin(units, eq(units.id, leaseLines.unitId))
    .innerJoin(properties, eq(properties.id, leaseLines.propertyId))
    .where(and(...conds))
    .orderBy(asc(properties.buCode), asc(properties.code), asc(units.unitCode));

  return rows.map(({ l, u, p }) => {
    const calc = (l.calc ?? null) as StoredCalc | null;
    const contracts = calc?.contracts ?? [];
    return {
      lineId: l.id,
      unitId: u.id,
      propertyId: p.id,
      buCode: p.buCode,
      coordinator: p.coordinator,
      propertyCode: p.code,
      propertyName: p.name,
      propertyKind: p.kind,
      unitCode: u.unitCode,
      bedroom: u.bedroom,
      area: u.area,
      rc: u.rc,
      pivotCategory: u.pivotCategory,
      unitType: u.unitType,
      rooms: u.rooms,
      capacity: u.capacity,
      tenant: l.tenant,
      vacant: l.vacant,
      staffOwner: l.staffOwner,
      mfCurrent: l.mfCurrent,
      currentRent: l.currentRent,
      currentStart: l.currentStart,
      currentEnd: l.currentEnd,
      renew1: l.renew1,
      noRenewal: l.noRenewal,
      r1Rent: l.r1Rent,
      r1Start: l.r1Start,
      r1End: l.r1End,
      r1Mf: l.r1Mf,
      r2Renew: l.r2Renew,
      r2Rent: l.r2Rent,
      r2Start: l.r2Start,
      r2End: l.r2End,
      r2Mf: l.r2Mf,
      budgetRate: l.budgetRate,
      increasePctOverride: l.increasePctOverride,
      cheques: l.cheques,
      notes: l.notes,
      r1: toDerived(contracts.find((c) => c.kind === 'RENEWAL1')),
      r2: toDerived(contracts.find((c) => c.kind === 'RENEWAL2')),
      increasePct: calc?.increasePct ?? null,
      reraAverage: calc?.reraAverage ?? null,
      vacancyLoss: calc?.vacancyLoss ?? 0,
      warnings: calc?.warnings ?? [],
      revenue: calc?.revenue ?? Array(12).fill(0),
      cash: calc?.cash ?? Array(12).fill(0),
      revenueTotal: calc?.totals.revenue ?? 0,
      cashTotal: calc?.totals.cash ?? 0,
      otherIncomeTotal: calc?.totals.otherIncome ?? 0,
      editable: opts.editableProperties ? opts.editableProperties.has(p.id) : false,
    };
  });
}
