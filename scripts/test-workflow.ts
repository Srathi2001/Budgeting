// Integration check of the save path against the database (run after the import):
// edits, overrides, permissions, validation, locked versions, audit trail. Restores data at the end.
import 'dotenv/config';
import { and, desc, eq, ne } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { applyLineChanges } from '../src/lib/budget/save';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function main() {
  const [open] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.status, 'OPEN'));
  const [locked] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.status, 'LOCKED'));
  const [pm] = await db.select().from(schema.users).where(eq(schema.users.email, 'ruchi@budget.local'));
  const [fin] = await db.select().from(schema.users).where(eq(schema.users.email, 'finance@budget.local'));

  // a residential, renewing unit of one of Ruchi's properties
  const [mine] = await db
    .select({ l: schema.leaseLines, p: schema.properties })
    .from(schema.leaseLines)
    .innerJoin(schema.properties, eq(schema.properties.id, schema.leaseLines.propertyId))
    .innerJoin(schema.units, eq(schema.units.id, schema.leaseLines.unitId))
    .where(and(eq(schema.leaseLines.versionId, open.id), eq(schema.properties.coordinator, 'RUCHI'), eq(schema.units.rc, 'R'), eq(schema.leaseLines.renew1, true)))
    .limit(1);
  const [theirs] = await db
    .select({ l: schema.leaseLines })
    .from(schema.leaseLines)
    .innerJoin(schema.properties, eq(schema.properties.id, schema.leaseLines.propertyId))
    .where(and(eq(schema.leaseLines.versionId, open.id), ne(schema.properties.coordinator, 'RUCHI')))
    .limit(1);
  const original = mine.l;
  const before = (original.calc as { totals: { revenue: number } }).totals.revenue;

  // 1. PM switches the unit to a new tenant at a higher budget rate
  let res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { renew1: false, budgetRate: 99999 } }]);
  const row = res.rows[0];
  check('PM can edit own property', res.errors.length === 0, res.errors[0]?.message);
  check('1st renewal goes to new tenant at budget rate', row.r1?.rent === 99999, `r1 rent ${row.r1?.rent}`);
  check('renewal starts after the 60-day gap', !!row.r1?.start && !!row.currentEnd && Date.parse(row.r1.start) - Date.parse(row.currentEnd) === 60 * 86400000, `${row.currentEnd} -> ${row.r1?.start}`);
  check('revenue recalculated', row.revenueTotal !== before, `${before} -> ${row.revenueTotal}`);
  const [monthly] = await db.execute<{ total: number }>(
    // line_monthly must agree with the cached total
    (await import('drizzle-orm')).sql`select sum(revenue)::float as total from line_monthly where line_id = ${original.id}`,
  ).then((r) => r.rows);
  check('monthly table updated', Math.abs(monthly.total - row.revenueTotal) < 0.05, `${monthly.total}`);
  const [audit] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, String(original.id))).orderBy(desc(schema.auditLog.id)).limit(1);
  check('audit trail written', !!audit && JSON.stringify(audit.changes).includes('budgetRate'));

  // 2. Override and revert the renewal rent
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { renew1: true, budgetRate: original.budgetRate, r1Rent: 12345 } }]);
  check('override wins', res.rows[0].r1?.rent === 12345);
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { r1Rent: null } }]);
  check('clearing override reverts to derived', res.rows[0].r1?.rent !== 12345 && Math.abs(res.rows[0].revenueTotal - before) < 0.05, `${res.rows[0].revenueTotal} vs ${before}`);

  // 3. Validation
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { currentRent: -5 } }]);
  check('negative rent rejected', res.errors.length === 1);
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { currentStart: '31/12/2026' } }]);
  check('bad date format rejected', res.errors.length === 1);

  // 4. Permissions
  res = await applyLineChanges(pm, open.id, [{ lineId: theirs.l.id, patch: { tenant: 'HACK' } }]);
  check("PM cannot edit another PM's property", res.errors[0]?.message === 'Not your property');
  await db
    .insert(schema.submissions)
    .values({ versionId: open.id, propertyId: original.propertyId, status: 'SUBMITTED' })
    .onConflictDoUpdate({ target: [schema.submissions.versionId, schema.submissions.propertyId], set: { status: 'SUBMITTED' } });
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { tenant: 'X' } }]);
  check('PM cannot edit a submitted property', /submitted/.test(res.errors[0]?.message ?? ''));
  res = await applyLineChanges(fin, open.id, [{ lineId: original.id, patch: { notes: 'finance note' } }]);
  check('Finance can still edit a submitted property', res.errors.length === 0);
  await db
    .update(schema.submissions)
    .set({ status: 'DRAFT' })
    .where(and(eq(schema.submissions.versionId, open.id), eq(schema.submissions.propertyId, original.propertyId)));

  const [lockedLine] = await db.select().from(schema.leaseLines).where(eq(schema.leaseLines.versionId, locked.id)).limit(1);
  res = await applyLineChanges(fin, locked.id, [{ lineId: lockedLine.id, patch: { tenant: 'X' } }]);
  check('locked version is read only, even for Finance', /locked/.test(res.errors[0]?.message ?? ''));

  // restore
  await applyLineChanges(fin, open.id, [{ lineId: original.id, patch: { notes: original.notes, renew1: original.renew1, budgetRate: original.budgetRate } }]);
  await db.delete(schema.auditLog).where(eq(schema.auditLog.entityId, String(original.id)));
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
