// Creates next year's budget version from an existing one: same units, no lease details
// (those are loaded from Oracle Fusion), RERA index and comparatives carried over.

import { eq, sql } from 'drizzle-orm';
import { type DB, schema } from '@/db';
import { recalcLines } from './calc';

const { budgetVersions, leaseLines, reraIndex, submissions, properties, comparatives } = schema;

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
      // unit-level budget inputs that still apply
      budgetRate: l.budgetRate,
      cheques: l.cheques,
      updatedBy: opts.userId,
    }));
    for (let i = 0; i < newLines.length; i += 500) {
      await tx.insert(leaseLines).values(newLines.slice(i, i + 500));
    }

    // RERA index carries over as a starting point
    await tx.execute(sql`
      insert into ${reraIndex} (version_id, property_code, bedroom, unit_type, min, max)
      select ${target.id}, property_code, bedroom, unit_type, min, max from ${reraIndex} where version_id = ${source.id}`);

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
