// Other income actuals from the Oracle Account Analysis Report (same as Admin → Account Analysis Report).
// Reads the file as a stream, so the full-ledger export (hundreds of MB) is fine.
//
//   npx tsx scripts/gl-import.ts <versionId> <Account Analysis Report.xls>           preview only
//   npx tsx scripts/gl-import.ts <versionId> <Account Analysis Report.xls> --apply   import
import 'dotenv/config';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { db } from '../src/db';
import { applyGlImport, planGlImport, scanOtherIncome } from '../src/lib/import/gl-other-income';

async function main() {
  const [versionId, file, flag] = process.argv.slice(2);
  if (!versionId || !file) throw new Error('usage: gl-import.ts <versionId> <report.xls> [--apply]');
  const scan = await scanOtherIncome(createReadStream(file, { highWaterMark: 8 << 20 }));
  const { values, preview: p } = await planGlImport(Number(versionId), scan);
  console.log(`${p.ledger} · ${p.periodFrom} – ${p.periodTo} · ${p.accounts} accounts, ${p.lines} lines, all reconciled to the account totals`);
  console.log(`Other income ${p.year - 3}A ${p.totals.A2.toLocaleString('en-US')} · ${p.year - 2}A ${p.totals.A1.toLocaleString('en-US')} · ${p.year - 1} Jan–Sep ${p.totals.YTD.toLocaleString('en-US')} · ${p.properties} properties`);
  console.table(p.byBu);
  console.log('On General rows:');
  console.table(p.general);
  for (const s of p.skipped) console.log(`Not imported: ${s.what}: ${s.detail}`);
  if (flag === '--apply') {
    await applyGlImport(Number(versionId), values, null, { file: basename(file), preview: p });
    console.log(`Imported ${values.length} values`);
  }
}

// close the pool before exiting: an abrupt disconnect can jam the PGlite dev server
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
