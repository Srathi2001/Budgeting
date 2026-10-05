// Loads Fusion exports into a budget version from the command line (same code as Admin → Fusion data).
// The Unit Dump goes first: its merged-unit numbers let leases on merged units find their member units.
//   npx tsx scripts/fusion-import.ts <versionId> <Lease Status Summary Report.xlsx> [Unit Dump.xlsx]
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { parseLeaseReport, applyFusionLeases, parseUnitDump, applyUnitDump } from '../src/lib/import/fusion';

(async () => {
  const [versionId, leaseFile, unitFile] = process.argv.slice(2);
  if (!versionId || !leaseFile) throw new Error('usage: fusion-import.ts <versionId> <lease report> [unit dump]');
  if (unitFile) {
    const units = parseUnitDump(readFileSync(unitFile));
    console.log(`unit dump: ${units.length} rows`, await applyUnitDump(Number(versionId), units, null));
  }
  const leases = parseLeaseReport(readFileSync(leaseFile));
  const r = await applyFusionLeases(Number(versionId), leases, null);
  console.log(`leases: ${leases.length} rows`, { ...r, createdUnits: r.createdUnits.length, sample: r.createdUnits.slice(0, 12) });
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
