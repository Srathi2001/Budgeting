// Revenue actuals from the Oracle Revenue Recognition Summary (same as Admin → Revenue Recognition Summary).
//
//   npx tsx scripts/revenue-import.ts <Revenue Recognition Summary.xlsx>           preview only
//   npx tsx scripts/revenue-import.ts <Revenue Recognition Summary.xlsx> --apply   import
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { db } from '../src/db';
import { applyRevenueImport, parseRevenueRecognition, planRevenueImport } from '../src/lib/import/revenue-recognition';

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file) throw new Error('usage: revenue-import.ts <report.xlsx> [--apply]');
  const report = parseRevenueRecognition(readFileSync(file));
  const p = flag === '--apply' ? await applyRevenueImport(report, null, basename(file)) : (await planRevenueImport(report)).preview;
  console.log(`Accounting periods ${p.accountingPeriods} (${p.from} – ${p.to}) · forecast ${p.forecastPeriod} · ${p.matched} properties`);
  console.table(p.years);
  console.log(`Oracle forecast (reference): ${p.oracleForecast.toLocaleString('en-US')}`);
  for (const u of p.unmatched) console.log(`Not in the budget: ${u.code} ${u.name} (${u.amount.toLocaleString('en-US')})`);
  if (flag === '--apply') console.log('Imported');
}

// close the pool before exiting: an abrupt disconnect can jam the PGlite dev server
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
