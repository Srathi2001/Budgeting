// Removes all lease details from a budget version, keeping its units (and unit-level inputs such as
// budget rate and cheques). Lease details are then loaded from Oracle Fusion.
//   npx tsx scripts/clear-leases.ts <versionId>
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { recalcLines } from '../src/lib/budget/calc';

(async () => {
  const versionId = Number(process.argv[2]);
  const [v] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!v) throw new Error('Pass a version id');
  if (v.status === 'LOCKED') throw new Error(`${v.name} is locked`);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.leaseLines)
      .set({
        leaseNumber: null, leaseVersion: null, tenantCode: null, tenant: null, customerClass: null,
        currentStart: null, rentStart: null, currentEnd: null, currentRent: null, vatAmount: null,
        securityDeposit: null, leaseStatus: null, leaseRemarks: null, currentSchedule: null, leaseSyncedAt: null,
        vacant: false, staffOwner: null, mfCurrent: null, renew1: true, noRenewal: false,
        r1Rent: null, r1Start: null, r1End: null, r1Mf: null, r1Schedule: null,
        r2Renew: null, r2Rent: null, r2Start: null, r2End: null, r2Mf: null, r2Schedule: null,
        r3Renew: null, r3Rent: null, r3Start: null, r3End: null, r3Mf: null, r3Schedule: null,
        increasePctOverride: null, notes: null,
      })
      .where(eq(schema.leaseLines.versionId, versionId));
    await recalcLines(tx, versionId);
  });
  console.log(`Cleared lease details in ${v.name}; units kept.`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
