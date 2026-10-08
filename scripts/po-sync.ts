// Contracts from Oracle purchase orders into the contract schedules (same as the Load from Oracle POs button).
//
//   npx tsx scripts/po-sync.ts <versionId> [since YYYY-MM-DD]          preview only
//   npx tsx scripts/po-sync.ts <versionId> [since YYYY-MM-DD] --apply  write
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { applyPurchaseOrders, readPurchaseOrders } from '../src/lib/import/fusion-po';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [versionId, sinceArg] = args.filter((a) => a !== '--apply');
  const [v] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, Number(versionId)));
  if (!v) throw new Error('usage: po-sync.ts <versionId> [since] [--apply]');
  const since = sinceArg ?? `${v.year - 1}-01-01`;
  const read = await readPurchaseOrders(since, (d, t) => d % 50 === 0 && console.log(`  ${d}/${t} POs`));
  console.log(`${read.pos} POs since ${since}: ${read.lines.length} contract lines on schedule accounts, ${read.skippedOneOff} one-off lines left out`);
  const byAcct = new Map<string, number>();
  for (const l of read.lines) byAcct.set(l.account, (byAcct.get(l.account) ?? 0) + 1);
  console.log('by account:', Object.fromEntries([...byAcct].sort()));
  if (apply) console.log(await applyPurchaseOrders(v.id, read, null));
}

// close the pool before exiting: an abrupt disconnect can jam the PGlite dev server
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
