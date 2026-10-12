// Saves running at the same moment, on a real PostgreSQL (the local PGlite database runs one thing at a
// time, so it can't show these). Builds its own small budget in an EMPTY database (CI: after the migrations),
// then checks that:
//   1. a PM's lease save during a recalculation waits for it, lands, and the stored results are current
//   2. a version lock waits for a save that is running, and saves after it are refused
//   3. approve and return of the same property at the same moment: one wins, the other is told who/when
//   4. two Admins saving different settings at the same moment: both kept
//   5. two people saving cells of the same building at the same moment: both land, no deadlock
// Exits with code 1 on a failure.
//
//   DATABASE_URL=postgres://… AUTH_SECRET=… npx tsx scripts/concurrency-check.ts
import 'dotenv/config';
import './allow-server-only';
import { setRequestCookies } from './request-shim';
import { and, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { db, schema } from '../src/db';
import { signSession, SESSION_COOKIE } from '../src/lib/auth/session';
import { VERSION_COOKIE } from '../src/lib/auth/dal';
import { canEditProperty, type Actor } from '../src/lib/auth/permissions';
import { writeGuard } from '../src/lib/write-guard';
import { recalcLines } from '../src/lib/budget/calc';
import { applyLineChanges } from '../src/lib/budget/save';
import { saveBuildingOverheads } from '../src/lib/budget/boh';
import { saveBohAssumptionsAs } from '../src/lib/budget/boh-schedules';
import { DEFAULT_ASSUMPTIONS } from '../src/lib/engine/assumptions';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
}

async function main() {
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from budget_versions`)).rows as { n: number }[];
  if (n > 0) throw new Error('Run this on an empty database (it builds its own budget)');

  // ---- a small budget: one BU, one building with two leased units, Admin and a PM ----
  await db.insert(schema.businessUnits).values({ code: '501', name: 'REHL' });
  const [prop] = await db.insert(schema.properties).values({ code: '30B999', name: 'Test building', buCode: '501', coordinator: 'TEST' }).returning();
  const [admin] = await db.insert(schema.users).values({ email: 'admin@test', name: 'Admin', passwordHash: 'x', role: 'ADMIN' }).returning();
  const [pm] = await db.insert(schema.users).values({ email: 'pm@test', name: 'Ruchi', passwordHash: 'x', role: 'PM', coordinator: 'TEST' }).returning();
  const [version] = await db.insert(schema.budgetVersions).values({ year: 2027, name: '2027 Budget', status: 'OPEN' }).returning();
  const v = version.id;
  const u = await db.insert(schema.units).values([1, 2].map((i) => ({ propertyId: prop.id, unitCode: `30B999-${i}`, rc: 'R' as const, bedroom: '1BR' }))).returning();
  const lines = await db
    .insert(schema.leaseLines)
    .values(u.map((x) => ({ versionId: v, unitId: x.id, propertyId: prop.id, tenant: 'Tenant', currentRent: 120000, currentStart: '2026-03-01', currentEnd: '2027-02-28', renew1: true, vacant: false })))
    .returning();
  await db.insert(schema.submissions).values({ versionId: v, propertyId: prop.id, status: 'DRAFT' });
  await db.transaction((tx) => recalcLines(tx, v).then(() => undefined));
  const actor = (x: typeof admin): Actor => ({ id: x.id, name: x.name, email: x.email, role: x.role, coordinator: x.coordinator });
  const as = async (x: typeof admin) => setRequestCookies({ [SESSION_COOKIE]: await signSession({ uid: x.id, role: x.role, coordinator: x.coordinator, name: x.name, sv: x.sessionVersion }), [VERSION_COOKIE]: String(v) });
  const monthly = async () => (await db.select().from(schema.lineMonthly).where(eq(schema.lineMonthly.lineId, lines[0].id))).map((r) => `${r.month}:${r.revenue}:${r.cash}`).sort().join('|');

  // ---- 1. lease save during a recalculation ----
  {
    const recalc = db.transaction(async (tx) => {
      await writeGuard(tx, v, { leases: true });
      await sleep(1500); // a long recalculation
      await recalcLines(tx, v);
    });
    await sleep(200);
    const t0 = Date.now();
    const saved = await applyLineChanges(actor(pm), v, [{ lineId: lines[0].id, patch: { r1Rent: 150000 } }]);
    const waited = Date.now() - t0;
    await recalc;
    const [line] = await db.select().from(schema.leaseLines).where(eq(schema.leaseLines.id, lines[0].id));
    const stored = await monthly();
    await db.transaction((tx) => recalcLines(tx, v).then(() => undefined));
    check('1. PM save during a recalculation: saved', saved.errors.length === 0 && line.r1Rent === 150000, JSON.stringify(saved.errors));
    check('1. PM save during a recalculation: waited for it', waited >= 1000, `${waited} ms`);
    check('1. stored results are current after both', stored === (await monthly()));
  }

  // ---- 2. a lock while a save is running ----
  {
    const running = db.transaction(async (tx) => {
      await writeGuard(tx, v, { properties: [prop.id] });
      await sleep(1200); // a save that takes a while
      await tx.insert(schema.bohBudget).values({ versionId: v, propertyId: prop.id, account: '64802', amount: 500, updatedBy: pm.id });
    });
    await sleep(200);
    const t0 = Date.now();
    await db.transaction(async (tx) => {
      await writeGuard(tx, v, { versionUpdate: true, leases: true }); // what setVersionStatus takes
      await tx.update(schema.budgetVersions).set({ status: 'LOCKED' }).where(eq(schema.budgetVersions.id, v));
    });
    const waited = Date.now() - t0;
    await running;
    check('2. lock waits for the running save', waited >= 800, `${waited} ms`);
    const after = await saveBuildingOverheads(actor(admin), v, [{ propertyId: prop.id, account: '64802', amount: 900, dueMonth: null }]);
    check('2. a save after the lock is refused', after.saved === 0 && after.errors.some((e) => /locked/i.test(e)), JSON.stringify(after.errors));
    const leaseAfter = await applyLineChanges(actor(pm), v, [{ lineId: lines[1].id, patch: { r1Rent: 99000 } }]);
    check('2. a lease save after the lock is refused', leaseAfter.errors.some((e) => /locked/i.test(e.message)));
    await db.update(schema.budgetVersions).set({ status: 'OPEN' }).where(eq(schema.budgetVersions.id, v));
  }

  // ---- 3. the same property approved twice at the same moment; a status someone else changed ----
  {
    const subWhere = and(eq(schema.submissions.versionId, v), eq(schema.submissions.propertyId, prop.id));
    await db.update(schema.submissions).set({ status: 'SUBMITTED', updatedBy: pm.id }).where(subWhere);
    await as(admin);
    const { transition } = await import('../src/app/(app)/submissions/actions');
    const [a, b] = await Promise.all([transition(v, prop.id, 'approve', null), transition(v, prop.id, 'approve', null)]);
    const loser = [a, b].find((r) => r.error);
    check('3. approved twice at once: exactly one goes through', [a, b].filter((r) => !r.error).length === 1, JSON.stringify([a, b]));
    check('3. the other is told it is approved', !!loser?.error && /Cannot approve a property that is approved/.test(loser.error), loser?.error);
    const n = (await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.entity, 'submission'), eq(schema.auditLog.action, 'approve')))).length;
    check('3. one approval in the history', n === 1, String(n));
    const pmCheck = await db.transaction((tx) => canEditProperty(actor(pm), v, prop.id, 'PM', tx));
    check('3. the approved property is frozen for the PM', !pmCheck.ok);
    // changed by someone else: the message says who and when
    await db.update(schema.submissions).set({ status: 'RETURNED', updatedBy: pm.id }).where(subWhere);
    const r = await transition(v, prop.id, 'approve', null);
    check('3. a status changed by someone else: who and when', !!r.error && /returned by Ruchi on \d{2}-\w{3}-\d{4} \d{2}:\d{2}/.test(r.error), r.error);
    await db.update(schema.submissions).set({ status: 'DRAFT' }).where(subWhere);
  }

  // ---- 4. two Admins saving different settings at the same moment ----
  {
    await as(admin);
    const { saveAssumptions } = await import('../src/app/(app)/admin/actions');
    const [r1, r2] = await Promise.all([
      saveAssumptions(v, { ...DEFAULT_ASSUMPTIONS, defaultVacancyDays: 45 } as never),
      saveBohAssumptionsAs(actor(admin), v, { bohUtilitiesPct: 0.05, insParPct: 0.05, insPlPct: 0.05, watchmanCost: 4321 }),
    ]);
    const [cur] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, v));
    const a = cur.assumptions as Record<string, unknown>;
    check('4. both saves succeed', !r1.error && !r2.error, JSON.stringify([r1, r2]));
    check('4. both changes kept', a.defaultVacancyDays === 45 && a.watchmanCost === 4321, JSON.stringify({ vacancy: a.defaultVacancyDays, watchman: a.watchmanCost }));
  }

  // ---- 5. two people saving cells of the same building at the same moment ----
  {
    const [x, y] = await Promise.all([
      saveBuildingOverheads(actor(pm), v, [{ propertyId: prop.id, account: '62401', amount: 1111, dueMonth: null }]),
      saveBuildingOverheads(actor(admin), v, [{ propertyId: prop.id, account: '62402', amount: 2222, dueMonth: null }]),
      applyLineChanges(actor(pm), v, [{ lineId: lines[1].id, patch: { r1Rent: 130000 } }]),
    ]);
    const cells = await db.select().from(schema.bohBudget).where(eq(schema.bohBudget.versionId, v));
    const has = (account: string, amount: number) => cells.some((c) => c.account === account && c.amount === amount);
    check('5. both cell saves land', x.errors.length + y.errors.length === 0 && has('62401', 1111) && has('62402', 2222), JSON.stringify([x.errors, y.errors]));
  }

  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
  if (failures.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => (db.$client as Pool).end());
