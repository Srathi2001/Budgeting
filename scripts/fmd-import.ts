// FMD budget file import from the command line (same as Admin → Imports → FMD budget file).
//
//   npx tsx scripts/fmd-import.ts <FMD_Budget_2026_….xlsx>           preview only
//   npx tsx scripts/fmd-import.ts <FMD_Budget_2026_….xlsx> --apply   import
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { db } from '../src/db';
import { applyFmdImport, parseFmdFile, previewFmdImport } from '../src/lib/import/fmd-budget';

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file) throw new Error('usage: fmd-import.ts <FMD budget file.xlsx> [--apply]');
  const parsed = parseFmdFile(readFileSync(file));
  const p = flag === '--apply' ? await applyFmdImport(parsed, null, basename(file)) : await previewFmdImport(parsed);
  console.log(`FMD ${p.year} → ${p.budgetVersion ?? '(no version)'}: ${p.lines} lines, AED ${p.total.toLocaleString('en-US')} on ${p.facilities} facilities`);
  console.log('by work type:', p.byWorkType);
  console.log(`staff (cost to company + overtime + G&A): AED ${p.staff.toLocaleString('en-US')}`);
  console.log(`facility master: ${parsed.facilities.length} facilities (zones, in service since, gross area, HVAC assets)`);
  for (const u of p.unmatched) console.log(`not in the budget: ${u.code} ${u.name} (AED ${u.amount.toLocaleString('en-US')})`);
  if (flag === '--apply') console.log('Imported');
}

// close the pool before exiting: an abrupt disconnect can jam the PGlite dev server
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
