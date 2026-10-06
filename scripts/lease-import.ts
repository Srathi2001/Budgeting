// Tenant and Lease Details Report import from the command line (same as Admin → Lease data).
// The version's lines are rebuilt from the report; budget inputs follow their units.
//
//   npx tsx scripts/lease-import.ts <versionId> <Tenant and Lease Details Report.xlsx>           preview only
//   npx tsx scripts/lease-import.ts <versionId> <Tenant and Lease Details Report.xlsx> --apply   import
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { applyImport, parseReport, planImport, type ImportPreview } from '../src/lib/import/tenant-lease';

function show(p: ImportPreview) {
  const r = p.result;
  console.log(`As of ${p.asOf}. Report: ${p.report.rows} rows, ${p.report.units} units, ${p.report.leases} leases, ${p.report.available} available`);
  console.log(`Lines: ${r.lines} (${r.leasedLines} leased, ${r.vacantLines} without a lease, ${r.multiUnitLines} covering several units); current rent AED ${r.currentRent.toLocaleString('en-US')}; ${r.contractedLines} with contracted later years`);
  console.table(r.byBu);
  console.log(`Kept (budget inputs carried): ${p.kept} · new lines: ${p.newLines.length} · removed lines: ${p.removedLines.length}`);
  for (const n of p.removedLines.slice(0, 60)) console.log(`   removed ${n.property} · ${n.code}${n.inputs ? ' (had budget inputs)' : ''}`);
  console.log(`New properties: ${p.newProperties.map((x) => `${x.code} ${x.name} [${x.bu}]`).join('; ') || 'none'}`);
  for (const s of p.skipped) console.log(`Not imported: ${s.what}: ${s.detail}`);
  for (const c of p.conflicts) console.log(`Overlap: ${c}`);
}

async function main() {
  const [versionId, file, flag] = process.argv.slice(2);
  if (!versionId || !file) throw new Error('usage: lease-import.ts <versionId> <report.xlsx> [--apply]');
  const rows = parseReport(readFileSync(file));
  if (flag === '--apply') show(await applyImport(Number(versionId), rows, null, basename(file)));
  else show((await planImport(Number(versionId), rows)).preview);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
