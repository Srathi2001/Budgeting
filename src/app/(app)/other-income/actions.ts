'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db, schema } from '@/db';
import { requireUser, canEditProperty } from '@/lib/auth/dal';

const Schema = z.object({
  versionId: z.number().int(),
  propertyId: z.number().int(),
  glCode: z.string().min(1),
  months: z.array(z.number().finite()).length(12),
});

export async function saveOtherIncome(input: z.infer<typeof Schema>): Promise<{ error?: string }> {
  const user = await requireUser();
  const d = Schema.parse(input);
  const check = await canEditProperty(user, d.versionId, d.propertyId);
  if (!check.ok) return { error: check.reason };
  const [gl] = await db.select().from(schema.glAccounts).where(eq(schema.glAccounts.code, d.glCode));
  if (!gl) return { error: 'Unknown GL account' };
  if (gl.autoSource) return { error: `${gl.name} is calculated from the lease data` };

  const where = and(
    eq(schema.otherIncome.versionId, d.versionId),
    eq(schema.otherIncome.propertyId, d.propertyId),
    eq(schema.otherIncome.glCode, d.glCode),
  );
  const [before] = await db.select().from(schema.otherIncome).where(where);
  if (d.months.every((m) => m === 0)) {
    if (before) await db.delete(schema.otherIncome).where(where);
  } else {
    await db
      .insert(schema.otherIncome)
      .values({ ...d, updatedBy: user.id })
      .onConflictDoUpdate({
        target: [schema.otherIncome.versionId, schema.otherIncome.propertyId, schema.otherIncome.glCode],
        set: { months: d.months, updatedAt: new Date(), updatedBy: user.id },
      });
  }
  await db.insert(schema.auditLog).values({
    userId: user.id,
    versionId: d.versionId,
    propertyId: d.propertyId,
    entity: 'other_income',
    entityId: d.glCode,
    action: 'update',
    changes: { from: before?.months ?? null, to: d.months },
  });
  revalidatePath('/other-income');
  return {};
}
