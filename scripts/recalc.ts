// Recalculates every budget version (or only the ids given): npx tsx scripts/recalc.ts [versionId...]
import 'dotenv/config';
import { db, schema } from '../src/db';
import { recalcLines } from '../src/lib/budget/calc';

(async () => {
  const wanted = process.argv.slice(2).map(Number);
  const versions = (await db.select().from(schema.budgetVersions)).filter((v) => !wanted.length || wanted.includes(v.id));
  for (const v of versions) {
    await db.transaction((tx) => recalcLines(tx, v.id));
    console.log('recalculated', v.name);
  }
  process.exit(0);
})();
