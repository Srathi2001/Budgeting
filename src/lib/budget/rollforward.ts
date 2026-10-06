// Creates next year's budget version from an existing one: same unit lines as a starting point, but no
// lease details, budget inputs or RERA index (the lease import rebuilds the lines from Oracle and the
// PMs enter the rest). Only the comparatives carry over, plus the source budget as "<year>B".

import { eq, sql } from 'drizzle-orm';
import { type DB, schema } from '@/db';
import { recalcLines } from './calc';

const { budgetVersions, leaseLines, submissions, properties, comparatives } = schema;

export async function rollForward(db: DB, sourceVersionId: number, opts: { name?: string; userId?: number } = {}) {
  return db.transaction(async (tx) => {
    const [source] = await tx.select().from(budgetVersions).where(eq(budgetVersions.id, sourceVersionId));
    if (!source) throw new Error('Source version not found');
    const year = source.year + 1;

    const [target] = await tx
      .insert(budgetVersions)
      .values({
        year,
        name: opts.name ?? `${year} Budget`,
        status: 'OPEN',
        sourceVersionId: source.id,
        assumptions: source.assumptions,
      })
      .returning();

    // Units carry over; lease details do not. The current lease of every unit comes from
    // Oracle Fusion (Admin → Fusion data), so a new version starts with units only.
    const lines = await tx.select().from(leaseLines).where(eq(leaseLines.versionId, source.id));
    const newLines: (typeof leaseLines.$inferInsert)[] = lines.map((l) => ({
      versionId: target.id,
      unitId: l.unitId,
      propertyId: l.propertyId,
      vacant: false,
      renew1: true,
      updatedBy: opts.userId,
    }));
    for (let i = 0; i < newLines.length; i += 500) {
      await tx.insert(leaseLines).values(newLines.slice(i, i + 500));
    }

    // The RERA index is not carried over: property managers enter the new year's ranges.

    // Comparatives: everything the source had, plus the source budget itself as "<year>B"
    await tx.execute(sql`
      insert into ${comparatives} (version_id, property_id, label, amount)
      select ${target.id}, property_id, label, amount from ${comparatives}
      where version_id = ${source.id} and label <> ${`${year - 1}B`}`);
    await tx.execute(sql`
      insert into ${comparatives} (version_id, property_id, label, amount)
      select ${target.id}, property_id, ${`${source.year}B`}, sum(revenue)
      from line_monthly where version_id = ${source.id} group by property_id
      on conflict (version_id, property_id, label) do nothing`);

    const props = await tx.select({ id: properties.id }).from(properties).where(eq(properties.active, true));
    if (props.length) {
      await tx.insert(submissions).values(props.map((p) => ({ versionId: target.id, propertyId: p.id, status: 'DRAFT' as const })));
    }

    await recalcLines(tx, target.id);
    return target;
  });
}
