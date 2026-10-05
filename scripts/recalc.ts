import 'dotenv/config';
import { db, schema } from '../src/db';
import { recalcLines } from '../src/lib/budget/calc';
import { eq } from 'drizzle-orm';
(async () => {
  const [v] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.status, 'OPEN'));
  await db.transaction((tx) => recalcLines(tx, v.id));
  console.log('recalculated', v.name);
  process.exit(0);
})();
