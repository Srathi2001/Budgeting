// Tenant and Lease Details Report import from the command line (same as Admin → Lease data).
// The version's lines are rebuilt from the report; budget inputs follow their units.
// The Unit Dump and the Maintenance Fee Report are optional.
//
//   npx tsx scripts/lease-import.ts <versionId> <report.xlsx> [--dump <Unit Dump.xls>] [--mf <MF Report.xls>]           preview only
//   npx tsx scripts/lease-import.ts <versionId> <report.xlsx> [--dump <Unit Dump.xls>] [--mf <MF Report.xls>] --apply   import
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseMfReport, parseUnitDump } from '../src/lib/import/oracle-extras';
import { applyImport, parseReport, planImport, type ImportPreview } from '../src/lib/import/tenant-lease';

function show(p: ImportPreview) {
  const r = p.result;
  console.log(`As of ${p.asOf}. Report: ${p.report.rows} rows, ${p.report.units} units, ${p.report.leases} leases, ${p.report.available} available`);
  console.log(`Lines: ${r.lines} (${r.leasedLines} leased, ${r.vacantLines} without a lease, ${r.multiUnitLines} covering several units); current rent AED ${r.currentRent.toLocaleString('en-US')}; ${r.contractedLines} with contracted later years`);
  console.table(r.byBu);
  console.log(`Kept (budget inputs carried): ${p.kept} · new lines: ${p.newLines.length} · removed lines: ${p.removedLines.length}`);
  for (const n of p.removedLines.slice(0, 60)) console.log(`   removed ${n.property} · ${n.code}${n.inputs ? ' (had budget inputs)' : ''}`);
  console.log(`New properties: ${p.newProperties.map((x) => `${x.code} ${x.name} [${x.bu}]`).join('; ') || 'none'}`);
  if (p.dump) console.log(`Unit Dump: ${p.dump.rows} rows; ${p.dump.matched} lines matched, ${p.dump.unmatched} not; status`, p.dump.status);
  if (p.mf) console.log(`MF report: ${p.mf.rows} rows; ${p.mf.matched} leased lines matched, ${p.mf.unmatched} not; MF AED ${p.mf.amount.toLocaleString('en-US')}, outstanding ${p.mf.outstanding.toLocaleString('en-US')};`, p.mf.status);
  for (const s of p.skipped) console.log(`Not imported: ${s.what}: ${s.detail}`);
  for (const c of p.conflicts) console.log(`Overlap: ${c}`);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const dumpFile = opt('--dump');
  const mfFile = opt('--mf');
  const [versionId, file, flag] = args;
  if (!versionId || !file) throw new Error('usage: lease-import.ts <versionId> <report.xlsx> [--dump <file>] [--mf <file>] [--apply]');
  const rows = parseReport(readFileSync(file));
  const extras = {
    dump: dumpFile ? parseUnitDump(readFileSync(dumpFile)) : null,
    mf: mfFile ? parseMfReport(readFileSync(mfFile)) : null,
    files: [file, dumpFile, mfFile].filter((f): f is string => !!f).map((f) => basename(f)),
  };
  if (flag === '--apply') show(await applyImport(Number(versionId), rows, null, basename(file), extras));
  else show((await planImport(Number(versionId), rows, extras)).preview);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
