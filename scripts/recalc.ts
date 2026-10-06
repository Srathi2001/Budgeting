// Recalculates open budget versions (or only the ids given): npx tsx scripts/recalc.ts [versionId...]
// Locked versions keep their stored results: unit details are shared with later years and change with
// each lease import, so recalculating a locked version would change its figures.
import 'dotenv/config';
import { db, schema } from '../src/db';
import { recalcLines } from '../src/lib/budget/calc';

async function main() {
  const wanted = process.argv.slice(2).map(Number);
  const versions = (await db.select().from(schema.budgetVersions)).filter((v) => !wanted.length || wanted.includes(v.id));
  for (const v of versions) {
    if (v.status === 'LOCKED') {
      console.log('skipped (locked)', v.name);
      continue;
    }
    await db.transaction((tx) => recalcLines(tx, v.id));
    console.log('recalculated', v.name);
  }
}

// close the pool before exiting: an abrupt disconnect can jam the PGlite dev server
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
