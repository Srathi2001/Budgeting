// Tenant and Lease Details Report import from the command line (same as Admin → Lease data).
//
//   npx tsx scripts/lease-import.ts <versionId> <Tenant and Lease Details Report.xlsx>           preview only
//   npx tsx scripts/lease-import.ts <versionId> <Tenant and Lease Details Report.xlsx> --apply   import
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { applyImport, parseReport, planImport, type ImportPreview } from '../src/lib/import/tenant-lease';

function show(p: ImportPreview) {
  console.log(`As of ${p.asOf}. Report: ${p.report.rows} rows, ${p.report.units} units, ${p.report.leases} leases, ${p.report.available} available`);
  console.log(`Lines: ${p.result.leasedLines} leased, ${p.result.vacantLines} without a lease; current rent AED ${p.result.currentRent.toLocaleString('en-US')}; ${p.result.contractedLines} with contracted later years`);
  console.table(p.result.byBu);
  console.log(`Leases matched by unit code: ${p.matchedByCode}; by tenant: ${p.matchedByTenant.length}`);
  for (const m of p.matchedByTenant) console.log(`   ${m.property} · ${m.line} ← ${m.lease} ${m.tenant}`);
  console.log(`New lines: ${p.newLines.length}`);
  for (const n of p.newLines.slice(0, 40)) console.log(`   ${n.property} · ${n.code} · ${n.tenant ?? '(available)'} · ${n.units} unit(s) · ${n.rent ?? ''}`);
  console.log(`New properties: ${p.newProperties.map((x) => `${x.code} ${x.name} [${x.bu}]`).join('; ') || 'none'}`);
  console.log(`Budget lines not in the report: ${p.notInReport.length}`);
  for (const n of p.notInReport.slice(0, 60)) console.log(`   ${n.property} · ${n.code}`);
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
