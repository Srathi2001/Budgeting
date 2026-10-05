// Applies grid edits to lease lines: validation, permissions, audit trail, recalculation.
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';
import { canEditProperty, editablePropertyIds, type Actor, type EditCheck } from '@/lib/auth/permissions';
import { recalcLines } from './calc';
import { loadMasterRows } from './master';
import { LINE_FIELDS, UNIT_FIELDS, type RowPatch, type SaveResult } from './master-types';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const money = z.number().finite().min(0).max(1e10);
const schedule = z.array(z.object({ date: isoDate, amount: z.number().finite().min(0).max(1e10) })).max(24);

const text = (max: number) => z.string().max(max).nullable();

export const PatchSchema = z
  .object({
    // current lease (also loaded from Fusion; an upload overwrites these)
    leaseNumber: text(60),
    leaseVersion: text(20),
    tenantCode: text(40),
    tenant: text(200),
    customerClass: text(60),
    currentStart: isoDate.nullable(),
    rentStart: isoDate.nullable(),
    currentEnd: isoDate.nullable(),
    currentRent: money.nullable(),
    vatAmount: money.nullable(),
    securityDeposit: money.nullable(),
    leaseStatus: text(40),
    leaseRemarks: text(2000),
    currentSchedule: schedule.nullable(),
    vacant: z.boolean(),
    mergedUnitNumber: text(80),
    unitStatus: text(40),
    resiCommercial: text(40),
    staffOwner: z.enum(['STAFF', 'OWNER']).nullable(),
    mfCurrent: z.boolean().nullable(),
    renew1: z.boolean(),
    noRenewal: z.boolean(),
    r1Rent: money.nullable(),
    r1Start: isoDate.nullable(),
    r1End: isoDate.nullable(),
    r1Mf: z.boolean().nullable(),
    r1Schedule: schedule.nullable(),
    r2Renew: z.boolean().nullable(),
    r2Rent: money.nullable(),
    r2Start: isoDate.nullable(),
    r2End: isoDate.nullable(),
    r2Mf: z.boolean().nullable(),
    r2Schedule: schedule.nullable(),
    r3Renew: z.boolean().nullable(),
    r3Rent: money.nullable(),
    r3Start: isoDate.nullable(),
    r3End: isoDate.nullable(),
    r3Mf: z.boolean().nullable(),
    r3Schedule: schedule.nullable(),
    budgetRate: money.nullable(),
    increasePctOverride: z.number().min(-1).max(5).nullable(),
    cheques: z.number().int().min(1).max(12).nullable(),
    notes: z.string().max(2000).nullable(),
    bedroom: z.string().max(40).nullable(),
    area: money.nullable(),
    rc: z.enum(['R', 'C', 'L']),
    pivotCategory: z.string().max(80).nullable(),
    unitType: z.string().max(80).nullable(),
    rooms: z.number().int().min(0).nullable(),
    capacity: z.number().int().min(0).nullable(),
    landlord: z.string().max(120).nullable(),
  })
  .partial()
  .strict();

const ChangesSchema = z.array(z.object({ lineId: z.number().int(), patch: PatchSchema })).max(2000);

export async function applyLineChanges(
  user: Actor,
  versionId: number,
  changes: { lineId: number; patch: RowPatch }[],
): Promise<SaveResult> {
  const parsed = ChangesSchema.safeParse(changes);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid input';
    return { rows: [], errors: changes.map((c) => ({ lineId: c.lineId, message })) };
  }
  const ids = parsed.data.map((c) => c.lineId);
  const current = await db
    .select({ l: schema.leaseLines, u: schema.units })
    .from(schema.leaseLines)
    .innerJoin(schema.units, eq(schema.units.id, schema.leaseLines.unitId))
    .where(and(eq(schema.leaseLines.versionId, versionId), inArray(schema.leaseLines.id, ids.length ? ids : [-1])));
  const byId = new Map(current.map((r) => [r.l.id, r]));

  // permission checks run before the transaction (they use their own connection)
  const checks = new Map<number, EditCheck>();
  for (const r of current) {
    if (!checks.has(r.l.propertyId)) checks.set(r.l.propertyId, await canEditProperty(user, versionId, r.l.propertyId));
  }

  const errors: SaveResult['errors'] = [];
  const touched: number[] = [];
  await db.transaction(async (tx) => {
    for (const { lineId, patch } of parsed.data) {
      const row = byId.get(lineId);
      if (!row) {
        errors.push({ lineId, message: 'Row not found in this version' });
        continue;
      }
      const check = checks.get(row.l.propertyId)!;
      if (!check.ok) {
        errors.push({ lineId, message: check.reason });
        continue;
      }
      const linePatch: Record<string, unknown> = {};
      const unitPatch: Record<string, unknown> = {};
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      for (const [k, v] of Object.entries(patch)) {
        if ((LINE_FIELDS as readonly string[]).includes(k)) {
          const before = (row.l as Record<string, unknown>)[k];
          if (JSON.stringify(before ?? null) !== JSON.stringify(v ?? null)) {
            linePatch[k] = v;
            diff[k] = { from: before, to: v };
          }
        } else if ((UNIT_FIELDS as readonly string[]).includes(k)) {
          const before = (row.u as Record<string, unknown>)[k];
          if (before !== v) {
            unitPatch[k] = v;
            diff[`unit.${k}`] = { from: before, to: v };
          }
        }
      }
      if (!Object.keys(diff).length) continue;
      if (Object.keys(linePatch).length) {
        await tx
          .update(schema.leaseLines)
          .set({ ...linePatch, updatedAt: new Date(), updatedBy: user.id })
          .where(eq(schema.leaseLines.id, lineId));
      }
      if (Object.keys(unitPatch).length) {
        await tx.update(schema.units).set(unitPatch).where(eq(schema.units.id, row.u.id));
      }
      await tx.insert(schema.auditLog).values({
        userId: user.id,
        versionId,
        propertyId: row.l.propertyId,
        entity: 'lease_line',
        entityId: String(lineId),
        action: 'update',
        changes: { unit: row.u.unitCode, ...diff },
      });
      touched.push(lineId);
    }
    if (touched.length) await recalcLines(tx, versionId, touched);
  });

  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  const editable = await editablePropertyIds(user, version);
  // return every requested row so the grid can roll back rejected edits
  const rows = await loadMasterRows(versionId, { lineIds: ids, editableProperties: editable });
  return { rows, errors };
}
