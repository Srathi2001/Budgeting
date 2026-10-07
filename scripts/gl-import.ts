// Other income actuals from the Oracle Account Analysis Report (same as Admin → Account Analysis Report),
// and from the MJN HOLDING report also the FM cost actuals (627xx / 117xx).
// Reads the file as a stream, so the full-ledger export (hundreds of MB) is fine.
//
//   npx tsx scripts/gl-import.ts <versionId> <Account Analysis Report.xls>           preview only
//   npx tsx scripts/gl-import.ts <versionId> <Account Analysis Report.xls> --apply   import
import 'dotenv/config';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { db } from '../src/db';
import { scanAccountAnalysis } from '../src/lib/import/gl-analysis';
import { applyFmActuals, isFmAccount, planFmActuals } from '../src/lib/import/gl-fm';
import { applyGlImport, isOtherIncome, planGlImport } from '../src/lib/import/gl-other-income';

async function main() {
  const [versionId, file, flag] = process.argv.slice(2);
  if (!versionId || !file) throw new Error('usage: gl-import.ts <versionId> <report.xls> [--apply]');
  const scan = await scanAccountAnalysis(createReadStream(file, { highWaterMark: 8 << 20 }), (a) => isOtherIncome(a) || isFmAccount(a));
  const fm = await planFmActuals(scan);
  scan.months = scan.months.filter((m) => isOtherIncome(m.account));
  const { values, preview: p } = await planGlImport(Number(versionId), scan);
  console.log(`${p.ledger} · ${p.periodFrom} – ${p.periodTo} · ${p.accounts} accounts, ${p.lines} lines, all reconciled to the account totals`);
  console.log(`Other income ${p.year - 3}A ${p.totals.A2.toLocaleString('en-US')} · ${p.year - 2}A ${p.totals.A1.toLocaleString('en-US')} · ${p.year - 1} Jan–Sep ${p.totals.YTD.toLocaleString('en-US')} · ${p.properties} properties`);
  console.table(p.byBu);
  console.log('On General rows:');
  console.table(p.general);
  for (const s of p.skipped) console.log(`Not imported: ${s.what}: ${s.detail}`);
  if (fm) {
    console.log(`FM cost actuals ${fm.preview.from} – ${fm.preview.to}: ${fm.rows.length} values; 627xx without a work type ${fm.preview.noWorkType.toLocaleString('en-US')}`);
    console.table(fm.preview.byYear);
    for (const u of fm.preview.unmatched) console.log(`FM costs on a building not in the budget: ${u.segment} ${u.amount.toLocaleString('en-US')}`);
  }
  if (flag === '--apply') {
    await applyGlImport(Number(versionId), values, null, { file: basename(file), preview: p });
    console.log(`Imported ${values.length} values`);
    if (fm) {
      await applyFmActuals(fm.rows, fm.preview, null, basename(file));
      console.log(`Imported ${fm.rows.length} FM cost actuals`);
    }
  }
}

// close the pool before exiting: an abrupt disconnect can jam the PGlite dev server
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
