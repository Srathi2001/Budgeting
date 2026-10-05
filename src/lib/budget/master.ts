import { and, eq, inArray, asc } from 'drizzle-orm';
import { db, schema } from '@/db';
import { formatDay } from '@/lib/engine/dates';
import type { Contract } from '@/lib/engine/lease';
import type { StoredCalc } from './calc';
import type { DerivedContract, MasterRow } from './master-types';

const { leaseLines, units, properties, businessUnits } = schema;

function toDerived(c: Contract | undefined): DerivedContract | null {
  if (!c) return null;
  return {
    rent: c.rent,
    start: formatDay(c.start),
    end: formatDay(c.end),
    mf: c.mf,
    schedule: (c.schedule ?? []).map((q) => ({ date: formatDay(q.date)!, amount: Math.round(q.amount * 100) / 100 })),
    scheduleSource: c.scheduleSource ?? 'EQUAL',
  };
}

export async function loadMasterRows(
  versionId: number,
  opts: { propertyIds?: number[]; lineIds?: number[]; editableProperties?: Set<number> } = {},
): Promise<MasterRow[]> {
  const conds = [eq(leaseLines.versionId, versionId)];
  if (opts.propertyIds) conds.push(inArray(leaseLines.propertyId, opts.propertyIds.length ? opts.propertyIds : [-1]));
  if (opts.lineIds) conds.push(inArray(leaseLines.id, opts.lineIds.length ? opts.lineIds : [-1]));
  const rows = await db
    .select({ l: leaseLines, u: units, p: properties, buName: businessUnits.name })
    .from(leaseLines)
    .innerJoin(units, eq(units.id, leaseLines.unitId))
    .innerJoin(properties, eq(properties.id, leaseLines.propertyId))
    .innerJoin(businessUnits, eq(businessUnits.code, properties.buCode))
    .where(and(...conds))
    .orderBy(asc(properties.buCode), asc(properties.code), asc(units.unitCode));

  return rows.map(({ l, u, p, buName }) => {
    const calc = (l.calc ?? null) as StoredCalc | null;
    const contracts = calc?.contracts ?? [];
    const find = (k: Contract['kind']) => toDerived(contracts.find((c) => c.kind === k));
    return {
      lineId: l.id,
      unitId: u.id,
      propertyId: p.id,
      buCode: p.buCode,
      buName,
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
      mergedUnitNumber: u.mergedUnitNumber,
      unitStatus: u.unitStatus,
      resiCommercial: u.resiCommercial,
      landlord: u.landlord,

      leaseNumber: l.leaseNumber,
      leaseVersion: l.leaseVersion,
      tenantCode: l.tenantCode,
      tenant: l.tenant,
      customerClass: l.customerClass,
      currentStart: l.currentStart,
      rentStart: l.rentStart,
      currentEnd: l.currentEnd,
      currentRent: l.currentRent,
      vatAmount: l.vatAmount,
      securityDeposit: l.securityDeposit,
      leaseStatus: l.leaseStatus,
      leaseRemarks: l.leaseRemarks,
      currentSchedule: l.currentSchedule ?? null,
      leaseSyncedAt: l.leaseSyncedAt ? l.leaseSyncedAt.toISOString() : null,
      vacant: l.vacant,

      staffOwner: l.staffOwner,
      mfCurrent: l.mfCurrent,
      renew1: l.renew1,
      noRenewal: l.noRenewal,
      r1Rent: l.r1Rent,
      r1Start: l.r1Start,
      r1End: l.r1End,
      r1Mf: l.r1Mf,
      r1Schedule: l.r1Schedule ?? null,
      r2Renew: l.r2Renew,
      r2Rent: l.r2Rent,
      r2Start: l.r2Start,
      r2End: l.r2End,
      r2Mf: l.r2Mf,
      r2Schedule: l.r2Schedule ?? null,
      r3Renew: l.r3Renew,
      r3Rent: l.r3Rent,
      r3Start: l.r3Start,
      r3End: l.r3End,
      r3Mf: l.r3Mf,
      r3Schedule: l.r3Schedule ?? null,
      budgetRate: l.budgetRate,
      increasePctOverride: l.increasePctOverride,
      cheques: l.cheques,
      notes: l.notes,

      current: find('CURRENT'),
      r1: find('RENEWAL1'),
      r2: find('RENEWAL2'),
      r3: find('RENEWAL3'),
      increasePct: calc?.increasePct ?? null,
      reraGap: calc?.reraGap ?? null,
      reraAverage: calc?.reraAverage ?? null,
      reraMin: calc?.rera?.min ?? null,
      reraMax: calc?.rera?.max ?? null,
      vacancyLoss: calc?.vacancyLoss ?? 0,
      warnings: calc?.warnings ?? [],
      revenue: calc?.revenue ?? Array(12).fill(0),
      cash: calc?.cash ?? Array(12).fill(0),
      cashFlow: calc?.cashFlow ?? Array(12).fill(0),
      revenueTotal: calc?.totals.revenue ?? 0,
      cashTotal: calc?.totals.cash ?? 0,
      cashFlowTotal: calc?.totals.cashFlow ?? 0,
      editable: opts.editableProperties ? opts.editableProperties.has(p.id) : false,
    };
  });
}
