// Several people save at the same time. A save's transaction calls writeGuard() first, so that:
// - a version locked (or a property submitted / approved) while a save is running can't take that save's
//   figures after the fact: the lock / transition waits for running saves, and later saves see the new
//   status (they read it inside their own transaction);
// - lease lines of a version change one save at a time (grid and template saves, RERA ranges, assumptions,
//   recalculation, Oracle imports, new units), so a recalculation never works from figures that change
//   under it and two of them can't collide;
// - a save that has to wait does so for at most LOCK_WAIT_MS (db/index.ts), then says so.
// Locks are always taken in this order (version, leases, FM staff, properties, facilities, then rows), so two
// saves can't wait for each other. They are transaction locks: released at commit or rollback.
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** the global db or a transaction: what reads inside a save use (never the global db while a save is open) */
export type Exec = typeof db | Tx;

// advisory lock key spaces (first key); the second key is the version or property id
const KEY = { leases: 7301, gl: 7302, revenue: 7303, newVersion: 7304, property: 7310, facility: 7311, fmStaff: 7312, settings: 7320 } as const;

export type LockMode = 'shared' | 'exclusive';

export interface GuardOptions {
  /** the save changes the version row itself (assumptions, status): take it exclusively */
  versionUpdate?: boolean;
  /** the save changes lease lines, units or RERA ranges of the version, or recalculates them */
  leases?: boolean;
  /** the FM staff budget: changed (exclusive) or read by a facility transition (shared) */
  fmStaff?: LockMode;
  /** properties whose inputs the save changes (shared) or whose status it changes (exclusive) */
  properties?: number[];
  propertyMode?: LockMode;
  /** facilities whose FM budget the save changes (shared) or whose status it changes (exclusive) */
  facilities?: number[];
  facilityMode?: LockMode;
}

const advisory = (tx: Tx, k1: number, k2: number, mode: LockMode) =>
  mode === 'shared' ? tx.execute(sql`select pg_advisory_xact_lock_shared(${k1}::int, ${k2}::int)`) : tx.execute(sql`select pg_advisory_xact_lock(${k1}::int, ${k2}::int)`);

/**
 * First statement(s) of a save's transaction. Returns the version as it is now (status included), locked
 * for the rest of the transaction; undefined when it doesn't exist.
 */
export async function writeGuard(tx: Tx, versionId: number, o: GuardOptions = {}): Promise<schema.BudgetVersion | undefined> {
  const q = tx.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  const [version] = await (o.versionUpdate ? q.for('update') : q.for('share'));
  if (!version) return undefined;
  if (o.leases) await advisory(tx, KEY.leases, versionId, 'exclusive');
  if (o.fmStaff) await advisory(tx, KEY.fmStaff, versionId, o.fmStaff);
  for (const p of [...new Set(o.properties ?? [])].sort((a, b) => a - b)) await advisory(tx, KEY.property, p, o.propertyMode ?? 'shared');
  for (const f of [...new Set(o.facilities ?? [])].sort((a, b) => a - b)) await advisory(tx, KEY.facility, f, o.facilityMode ?? 'shared');
  return version;
}

/** Imports and other one-at-a-time jobs that aren't tied to a version's rows (GL actuals, revenue actuals, new versions, settings). */
export async function lockJob(tx: Tx, job: 'gl' | 'revenue' | 'newVersion' | 'settings', id = 0) {
  await advisory(tx, KEY[job], id, 'exclusive');
}
