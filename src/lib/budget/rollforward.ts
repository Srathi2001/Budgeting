// Creates next year's budget version from an existing one.
//
// For each unit, the contract in force on 1 January of the new year (from the source version's
// contract chain) becomes the new "current contract". Renewal terms are left to be derived
// (RERA / budget rate rules) so property managers only need to correct what has changed.

import { eq, sql } from 'drizzle-orm';
import { type DB, schema } from '@/db';
import { dayFromYMD, formatDay } from '@/lib/engine/dates';
import type { Contract } from '@/lib/engine/lease';
import { recalcLines, type StoredCalc } from './calc';

const { budgetVersions, leaseLines, reraIndex, otherIncome, submissions, properties, comparatives } = schema;

export async function rollForward(db: DB, sourceVersionId: number, opts: { name?: string; userId?: number } = {}) {
  return db.transaction(async (tx) => {
    const [source] = await tx.select().from(budgetVersions).where(eq(budgetVersions.id, sourceVersionId));
    if (!source) throw new Error('Source version not found');
    const year = source.year + 1;
    const jan1 = dayFromYMD(year, 1, 1);

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

    const lines = await tx.select().from(leaseLines).where(eq(leaseLines.versionId, source.id));
    const newLines: (typeof leaseLines.$inferInsert)[] = [];
    for (const l of lines) {
      const calc = l.calc as StoredCalc | null;
      const chain: Contract[] = calc?.contracts ?? [];
      const inForce = chain.find((c) => c.start <= jan1 && c.end >= jan1);
      const next = chain.find((c) => c.start > jan1);
      const chosen = inForce ?? next ?? chain[chain.length - 1];

      const base = {
        versionId: target.id,
        unitId: l.unitId,
        propertyId: l.propertyId,
        staffOwner: l.staffOwner,
        noRenewal: l.noRenewal,
        budgetRate: l.budgetRate,
        cheques: l.cheques,
        updatedBy: opts.userId,
      };
      if (!chosen) {
        // No contract history at all: stays vacant until the PM enters a lease
        newLines.push({ ...base, tenant: l.tenant, vacant: true, renew1: false, notes: 'Rolled forward: no contract' });
        continue;
      }
      const sameTenant = chosen.kind === 'CURRENT' || !chosen.newTenant;
      newLines.push({
        ...base,
        tenant: sameTenant ? l.tenant : 'NEW TENANT (budget)',
        vacant: !inForce,
        mfCurrent: chosen.mf,
        currentRent: chosen.rent,
        currentStart: formatDay(chosen.start),
        currentEnd: formatDay(chosen.end),
        // A lease that had already expired before the year starts goes to a new tenant
        renew1: chosen.end >= jan1 ? true : false,
        notes: `Rolled forward from ${source.name}: ${chosen.kind.toLowerCase().replace('renewal', 'renewal ')}`,
      });
    }
    for (let i = 0; i < newLines.length; i += 500) {
      await tx.insert(leaseLines).values(newLines.slice(i, i + 500));
    }

    // RERA index and manual other income carry over as a starting point
    await tx.execute(sql`
      insert into ${reraIndex} (version_id, property_code, bedroom, unit_type, min, max)
      select ${target.id}, property_code, bedroom, unit_type, min, max from ${reraIndex} where version_id = ${source.id}`);
    await tx.execute(sql`
      insert into ${otherIncome} (version_id, property_id, gl_code, months, note, updated_by)
      select ${target.id}, property_id, gl_code, months, note, ${opts.userId ?? null} from ${otherIncome} where version_id = ${source.id}`);

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
