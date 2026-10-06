'use server';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';
import { requireUser, canEditProperty, editablePropertyIds } from '@/lib/auth/dal';
import { recalcLines } from '@/lib/budget/calc';
import { loadMasterRows } from '@/lib/budget/master';
import { applyLineChanges } from '@/lib/budget/save';
import type { RowPatch, SaveResult, MasterRow } from '@/lib/budget/master-types';

export async function saveLines(versionId: number, changes: { lineId: number; patch: RowPatch }[]): Promise<SaveResult> {
  const user = await requireUser();
  return applyLineChanges(user, versionId, changes);
}
const NewUnitSchema = z.object({
  propertyId: z.number().int(),
  unitCode: z.string().trim().min(1).max(80),
  rc: z.enum(['R', 'C', 'L']),
  bedroom: z.string().max(40).nullable(),
  area: z.number().min(0).nullable(),
  unitType: z.string().max(80).nullable(),
});

export async function addUnit(
  versionId: number,
  input: z.infer<typeof NewUnitSchema>,
): Promise<{ row?: MasterRow; error?: string }> {
  const user = await requireUser();
  const parsed = NewUnitSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const check = await canEditProperty(user, versionId, parsed.data.propertyId);
  if (!check.ok) return { error: check.reason };

  const lineId = await db.transaction(async (tx) => {
    let [unit] = await tx.select().from(schema.units).where(eq(schema.units.unitCode, parsed.data.unitCode));
    if (unit && unit.propertyId !== parsed.data.propertyId) throw new Error('That unit code belongs to another property');
    if (!unit) {
      [unit] = await tx
        .insert(schema.units)
        .values({
          propertyId: parsed.data.propertyId,
          unitCode: parsed.data.unitCode,
          rc: parsed.data.rc,
          bedroom: parsed.data.bedroom,
          area: parsed.data.area,
          unitType: parsed.data.unitType,
        })
        .returning();
    }
    const [exists] = await tx
      .select()
      .from(schema.leaseLines)
      .where(and(eq(schema.leaseLines.versionId, versionId), eq(schema.leaseLines.unitId, unit.id)));
    if (exists) throw new Error('Unit is already in this budget');
    const [line] = await tx
      .insert(schema.leaseLines)
      .values({ versionId, unitId: unit.id, propertyId: unit.propertyId, vacant: true, renew1: false, tenant: 'VACANT', updatedBy: user.id })
      .returning();
    await tx.insert(schema.auditLog).values({
      userId: user.id,
      versionId,
      propertyId: unit.propertyId,
      entity: 'lease_line',
      entityId: String(line.id),
      action: 'create',
      changes: { unit: unit.unitCode },
    });
    await recalcLines(tx, versionId, [line.id]);
    return line.id;
  }).catch((e: Error) => e);
  if (lineId instanceof Error) return { error: lineId.message };
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  const [row] = await loadMasterRows(versionId, { lineIds: [lineId], editableProperties: await editablePropertyIds(user, version) });
  return { row };
}

const ReraSchema = z.object({
  propertyId: z.number().int(),
  bedroom: z.string().trim().min(1, 'The unit has no bedroom / RERA code').max(40),
  min: z.number().min(0).max(1e9).nullable(),
  max: z.number().min(0).max(1e9).nullable(),
});

/**
 * RERA rent range for one property and bedroom code, entered by the property's PM (or Finance).
 * Both blank removes the row. Every line of the property with that code is recalculated.
 */
export async function saveRera(versionId: number, input: z.infer<typeof ReraSchema>): Promise<{ rows?: MasterRow[]; error?: string }> {
  const user = await requireUser();
  const parsed = ReraSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { propertyId, bedroom, min, max } = parsed.data;
  if ((min === null) !== (max === null)) return { error: 'Enter both the low and the high rent, or clear both' };
  if (min !== null && max !== null && min > max) return { error: 'The low rent is above the high rent' };
  const check = await canEditProperty(user, versionId, propertyId);
  if (!check.ok) return { error: check.reason };
  const [property] = await db.select().from(schema.properties).where(eq(schema.properties.id, propertyId));
  if (!property) return { error: 'Property not found' };
  const code = bedroom.toUpperCase();

  const lineIds = await db.transaction(async (tx) => {
    const where = and(eq(schema.reraIndex.versionId, versionId), eq(schema.reraIndex.propertyCode, property.code), eq(schema.reraIndex.bedroom, code));
    await tx.delete(schema.reraIndex).where(where);
    if (min !== null && max !== null) await tx.insert(schema.reraIndex).values({ versionId, propertyCode: property.code, bedroom: code, min, max });
    await tx.insert(schema.auditLog).values({
      userId: user.id,
      versionId,
      propertyId,
      entity: 'rera_index',
      entityId: `${property.code}|${code}`,
      action: min === null ? 'delete' : 'upsert',
      changes: { min, max },
    });
    const lines = await tx
      .select({ id: schema.leaseLines.id, bedroom: schema.units.bedroom })
      .from(schema.leaseLines)
      .innerJoin(schema.units, eq(schema.units.id, schema.leaseLines.unitId))
      .where(and(eq(schema.leaseLines.versionId, versionId), eq(schema.leaseLines.propertyId, propertyId)));
    const ids = lines.filter((l) => (l.bedroom ?? '').trim().toUpperCase() === code).map((l) => l.id);
    if (ids.length) await recalcLines(tx, versionId, ids);
    return ids;
  });
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  return { rows: await loadMasterRows(versionId, { lineIds, editableProperties: await editablePropertyIds(user, version) }) };
}

export async function removeLine(versionId: number, lineId: number): Promise<{ error?: string }> {
  const user = await requireUser();
  const [line] = await db
    .select({ l: schema.leaseLines, u: schema.units })
    .from(schema.leaseLines)
    .innerJoin(schema.units, eq(schema.units.id, schema.leaseLines.unitId))
    .where(and(eq(schema.leaseLines.id, lineId), eq(schema.leaseLines.versionId, versionId)));
  if (!line) return { error: 'Row not found' };
  const check = await canEditProperty(user, versionId, line.l.propertyId);
  if (!check.ok) return { error: check.reason };
  await db.transaction(async (tx) => {
    await tx.delete(schema.leaseLines).where(eq(schema.leaseLines.id, lineId));
    await tx.insert(schema.auditLog).values({
      userId: user.id,
      versionId,
      propertyId: line.l.propertyId,
      entity: 'lease_line',
      entityId: String(lineId),
      action: 'delete',
      changes: { unit: line.u.unitCode, tenant: line.l.tenant, currentRent: line.l.currentRent },
    });
  });
  return {};
}
