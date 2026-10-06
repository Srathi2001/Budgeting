// Integration check of the save path against the database (run after the import):
// edits, overrides, permissions, validation, locked versions, audit trail. Restores data at the end.
import 'dotenv/config';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { applyLineChanges } from '../src/lib/budget/save';
import { recalcLines } from '../src/lib/budget/calc';
import { saveOtherIncome } from '../src/lib/budget/other-income';

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
  const [admin] = await db.select().from(schema.users).where(eq(schema.users.email, 'admin@budget.local'));

  // a residential unit of one of Ruchi's properties
  const [mine] = await db
    .select({ l: schema.leaseLines, p: schema.properties })
    .from(schema.leaseLines)
    .innerJoin(schema.properties, eq(schema.properties.id, schema.leaseLines.propertyId))
    .innerJoin(schema.units, eq(schema.units.id, schema.leaseLines.unitId))
    .where(and(eq(schema.leaseLines.versionId, open.id), eq(schema.properties.coordinator, 'RUCHI'), eq(schema.units.rc, 'R'), eq(schema.leaseLines.contracted, 0)))
    .limit(1);
  const [theirs] = await db
    .select({ l: schema.leaseLines, p: schema.properties })
    .from(schema.leaseLines)
    .innerJoin(schema.properties, eq(schema.properties.id, schema.leaseLines.propertyId))
    .where(and(eq(schema.leaseLines.versionId, open.id), ne(schema.properties.coordinator, 'RUCHI')))
    .limit(1);
  const original = mine.l;

  // give it a current lease the way the Fusion sync would (lease facts are not editable in the tool)
  await db
    .update(schema.leaseLines)
    .set({ tenant: 'TEST TENANT', currentRent: 60000, currentStart: '2026-07-01', currentEnd: '2027-06-30', renew1: true, budgetRate: null })
    .where(eq(schema.leaseLines.id, original.id));
  await recalcLines(db, open.id, [original.id]);
  const [seeded] = await db.select().from(schema.leaseLines).where(eq(schema.leaseLines.id, original.id));
  const before = (seeded.calc as { totals: { revenue: number } }).totals.revenue;

  // 1. PM switches the unit to a new tenant at a higher budget rate
  let res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { renew1: false, budgetRate: 99999, vacancyDays: 59 } }]);
  const row = res.rows[0];
  check('PM can edit own property', res.errors.length === 0, res.errors[0]?.message);
  check('1st renewal goes to new tenant at budget rate', row.r1?.rent === 99999, `r1 rent ${row.r1?.rent}`);
  check('new tenant starts after the 59 vacancy days entered', !!row.r1?.start && !!row.currentEnd && Date.parse(row.r1.start) - Date.parse(row.currentEnd) === 60 * 86400000, `${row.currentEnd} -> ${row.r1?.start}`);
  check('revenue recalculated', row.revenueTotal !== before, `${before} -> ${row.revenueTotal}`);
  const [monthly] = await db.execute<{ total: number }>(
    // line_monthly must agree with the cached total
    (await import('drizzle-orm')).sql`select sum(revenue)::float as total from line_monthly where line_id = ${original.id}`,
  ).then((r) => r.rows);
  check('monthly table updated', Math.abs(monthly.total - row.revenueTotal) < 0.05, `${monthly.total}`);
  const [audit] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, String(original.id))).orderBy(desc(schema.auditLog.id)).limit(1);
  check('audit trail written', !!audit && JSON.stringify(audit.changes).includes('budgetRate'));

  // 2. Override and revert the renewal rent
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { renew1: true, budgetRate: null, r1Rent: 12345 } }]);
  check('override wins', res.rows[0].r1?.rent === 12345);
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { r1Rent: null } }]);
  check('clearing override reverts to derived', res.rows[0].r1?.rent !== 12345 && Math.abs(res.rows[0].revenueTotal - before) < 0.05, `${res.rows[0].revenueTotal} vs ${before}`);

  // 3. Validation
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { budgetRate: -5 } }]);
  check('negative rate rejected', res.errors.length === 1);
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { r1Start: '31/12/2026' } }]);
  check('bad date format rejected', res.errors.length === 1);
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { currentRent: 72000, tenant: 'EDITED TENANT' } }]);
  check('PM cannot change Oracle lease fields', /Fixed/.test(res.errors[0]?.message ?? ''), res.errors[0]?.message);
  res = await applyLineChanges(fin, open.id, [{ lineId: original.id, patch: { area: 999 } }]);
  check('Finance cannot change Oracle unit fields', /Fixed/.test(res.errors[0]?.message ?? ''), res.errors[0]?.message);
  res = await applyLineChanges(admin, open.id, [{ lineId: original.id, patch: { currentRent: 72000, tenant: 'EDITED TENANT' } }]);
  check('admin cannot change Oracle lease fields either', /Fixed/.test(res.errors[0]?.message ?? ''), res.errors[0]?.message);
  // new tenant: vacancy days are required; the start follows from them
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { renew1: false, budgetRate: 70000, vacancyDays: null } }]);
  check('new tenant without vacancy days is flagged, not budgeted', !res.rows[0].r1 && res.rows[0].warnings.some((w) => /vacancy days/.test(w)));
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { vacancyDays: 30 } }]);
  check('vacancy days set the new tenant start', Date.parse(res.rows[0].r1?.start ?? '') - Date.parse(res.rows[0].currentEnd ?? '') === 31 * 86400000, `${res.rows[0].currentEnd} -> ${res.rows[0].r1?.start}`);
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { vacancyDays: -1 } }]);
  check('negative vacancy days rejected', res.errors.length === 1);
  await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { renew1: true, budgetRate: null, vacancyDays: null } }]);
  // contracted lease years are fixed for everyone but an admin
  const [withYears] = await db
    .select({ l: schema.leaseLines })
    .from(schema.leaseLines)
    .where(and(eq(schema.leaseLines.versionId, open.id), sql`${schema.leaseLines.contracted} > 0`))
    .limit(1);
  if (withYears) {
    res = await applyLineChanges(fin, open.id, [{ lineId: withYears.l.id, patch: { r1Rent: 1 } }]);
    check('contracted renewal is fixed', /Fixed/.test(res.errors[0]?.message ?? ''), res.errors[0]?.message);
  }

  // maintenance fee on the renewal: 5% of the renewal rent in its start month, unless No / Waived off
  await db.update(schema.leaseLines).set({ mfCurrent: true, mfStatus: null, mfRenewal: 'NO' }).where(eq(schema.leaseLines.id, original.id));
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { mfRenewal: null } }]);  const r1Rent = res.rows[0].r1?.rent ?? 0;
  check('MF on renewal defaults to the current lease (Yes)', Math.abs(res.rows[0].maintenanceTotal - r1Rent * 0.05) < 0.05, `${res.rows[0].maintenanceTotal} vs 5% of ${r1Rent}`);
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { mfRenewal: 'WAIVED' } }]);
  check('MF waived off on renewal: none budgeted', res.errors.length === 0 && res.rows[0].maintenanceTotal === 0, res.errors[0]?.message);
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { mfRenewal: 'MAYBE' as never } }]);
  check('unknown MF choice rejected', res.errors.length === 1);
  await db.update(schema.leaseLines).set({ mfStatus: 'Yes' }).where(eq(schema.leaseLines.id, original.id));
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { mfCurrent: false } }]);
  check('MF on the current lease is fixed once the MF report has it', /Fixed/.test(res.errors[0]?.message ?? ''), res.errors[0]?.message);

  // other income: PM inputs on own properties; General is Finance only; the MF budget is calculated
  const own = `P:${original.propertyId}`;
  let oi = await saveOtherIncome(pm, open.id, [{ scope: own, account: '52703', period: 'B', amount: 1234 }]);
  check('PM can budget other income on own property', oi.saved === 1 && !oi.errors.length, oi.errors[0]);
  oi = await saveOtherIncome(pm, open.id, [{ scope: own, account: '52702', period: 'B', amount: 1 }]);
  check('maintenance service fee budget is calculated, not typed', oi.saved === 0 && /calculated/.test(oi.errors[0] ?? ''), oi.errors[0]);
  oi = await saveOtherIncome(pm, open.id, [{ scope: `P:${theirs.l.propertyId}`, account: '52703', period: 'B', amount: 1 }]);
  check("PM cannot budget another PM's other income", oi.saved === 0 && /Not your property/.test(oi.errors[0] ?? ''), oi.errors[0]);
  oi = await saveOtherIncome(pm, open.id, [{ scope: `G:${mine.p.buCode}`, account: '52201', period: 'B', amount: 1 }]);
  check('General (company level) is Finance only', oi.saved === 0 && /Finance only/.test(oi.errors[0] ?? ''), oi.errors[0]);
  oi = await saveOtherIncome(fin, open.id, [{ scope: own, account: '52703', period: 'YTD', amount: 1 }]);
  check('actuals are not typed', oi.saved === 0, oi.errors[0]);
  await db.delete(schema.otherIncome).where(and(eq(schema.otherIncome.versionId, open.id), eq(schema.otherIncome.scope, own), eq(schema.otherIncome.account, '52703')));
  await db.delete(schema.auditLog).where(and(eq(schema.auditLog.entity, 'other_income'), eq(schema.auditLog.entityId, `${own}|52703|B`)));

  // 4. Permissions
  res = await applyLineChanges(pm, open.id, [{ lineId: theirs.l.id, patch: { notes: 'HACK' } }]);
  check("PM cannot edit another PM's property", res.errors[0]?.message === 'Not your property');
  await db
    .insert(schema.submissions)
    .values({ versionId: open.id, propertyId: original.propertyId, status: 'SUBMITTED' })
    .onConflictDoUpdate({ target: [schema.submissions.versionId, schema.submissions.propertyId], set: { status: 'SUBMITTED' } });
  res = await applyLineChanges(pm, open.id, [{ lineId: original.id, patch: { notes: 'X' } }]);
  check('PM cannot edit a submitted property', /submitted/.test(res.errors[0]?.message ?? ''));
  res = await applyLineChanges(fin, open.id, [{ lineId: original.id, patch: { notes: 'finance note' } }]);
  check('Finance can still edit a submitted property', res.errors.length === 0);
  await db
    .update(schema.submissions)
    .set({ status: 'DRAFT' })
    .where(and(eq(schema.submissions.versionId, open.id), eq(schema.submissions.propertyId, original.propertyId)));

  const [lockedLine] = await db.select().from(schema.leaseLines).where(eq(schema.leaseLines.versionId, locked.id)).limit(1);
  res = await applyLineChanges(fin, locked.id, [{ lineId: lockedLine.id, patch: { notes: 'X' } }]);
  check('locked version is read only, even for Finance', /locked/.test(res.errors[0]?.message ?? ''));

  // restore
  await db
    .update(schema.leaseLines)
    .set({
      tenant: original.tenant,
      currentRent: original.currentRent,
      currentStart: original.currentStart,
      currentEnd: original.currentEnd,
      notes: original.notes,
      renew1: original.renew1,
      budgetRate: original.budgetRate,
      vacancyDays: original.vacancyDays,
      r1Rent: original.r1Rent,
      mfCurrent: original.mfCurrent,
      mfStatus: original.mfStatus,
      mfRenewal: original.mfRenewal,
    })
    .where(eq(schema.leaseLines.id, original.id));
  await recalcLines(db, open.id, [original.id]);
  await db.delete(schema.auditLog).where(eq(schema.auditLog.entityId, String(original.id)));
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
