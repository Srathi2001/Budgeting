// RERA rent range for one property and RERA (bedroom) code in a budget version, entered by PMs.
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Actor } from '@/lib/auth/permissions';
import { recalcLines } from './calc';

/**
 * Saves (or, with both blank, removes) the range and recalculates every line of the property with
 * that code. The caller checks that the user may edit the property. Returns the recalculated line ids.
 */
export async function saveReraRange(
  user: Actor,
  versionId: number,
  propertyId: number,
  bedroom: string,
  min: number | null,
  max: number | null,
): Promise<{ lineIds?: number[]; error?: string }> {
  const code = bedroom.trim().toUpperCase();
  if (!code) return { error: 'The unit has no bedroom / RERA code' };
  if ((min === null) !== (max === null)) return { error: 'Enter both the low and the high rent, or clear both' };
  if (min !== null && max !== null && (min < 0 || max < 0)) return { error: 'RERA rents can’t be negative' };
  if (min !== null && max !== null && min > max) return { error: 'The low rent is above the high rent' };
  const [property] = await db.select().from(schema.properties).where(eq(schema.properties.id, propertyId));
  if (!property) return { error: 'Property not found' };

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
  return { lineIds };
}
