'use server';

// "Last updated by … on …" for the side forms: the latest change of a record in the change history
// (audit_log), so an Oracle import, a template upload or a screen edit all count.
import { and, desc, eq, like, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';
import { requireUser } from '@/lib/auth/dal';

const Query = z.object({
  entity: z.string().max(40),
  versionId: z.number().int().optional(),
  entityId: z.string().max(200).optional(),
  /** entity ids that contain this text (e.g. a department in the admin overheads' keys) */
  entityIdHas: z.string().max(200).optional(),
  propertyId: z.number().int().optional(),
  /** audit rows whose changes contain this JSON (e.g. [{ "propertyId": 12 }] for the insurance list) */
  changesContain: z.unknown().optional(),
});

export async function lastUpdated(query: z.infer<typeof Query>): Promise<{ by: string | null; at: string } | null> {
  await requireUser();
  const q = Query.parse(query);
  const a = schema.auditLog;
  const [r] = await db
    .select({ by: schema.users.name, at: a.at })
    .from(a)
    .leftJoin(schema.users, eq(schema.users.id, a.userId))
    .where(
      and(
        eq(a.entity, q.entity),
        q.versionId !== undefined ? eq(a.versionId, q.versionId) : undefined,
        q.entityId !== undefined ? eq(a.entityId, q.entityId) : undefined,
        q.entityIdHas !== undefined ? like(a.entityId, `%${q.entityIdHas.replace(/[%_\\]/g, (c) => `\\${c}`)}%`) : undefined,
        q.propertyId !== undefined ? eq(a.propertyId, q.propertyId) : undefined,
        q.changesContain !== undefined ? sql`${a.changes} @> ${JSON.stringify(q.changesContain)}::jsonb` : undefined,
      ),
    )
    .orderBy(desc(a.id))
    .limit(1);
  return r ? { by: r.by, at: r.at.toISOString() } : null;
}
