// Applies the migrations in ./drizzle to DATABASE_URL (drizzle-orm's migrator keeps its own ledger in
// the __drizzle_migrations table). Fresh databases: run this instead of `db:push`. A database made with
// `db:push` before migrations existed: run `db:push` once more (it adds what the newest schema needs) and
// then `npx tsx scripts/migrate.ts --baseline` to record the baseline as already applied.
import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { db } from '../src/db';

async function main() {
  if (process.argv.includes('--baseline')) {
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string; when: number }[] };
    const first = journal.entries[0];
    // the same hash drizzle's migrator records (sha256 of the migration file)
    const hash = createHash('sha256').update(readFileSync(`drizzle/${first.tag}.sql`, 'utf8')).digest('hex');
    await db.execute(sql`create schema if not exists drizzle`);
    await db.execute(sql`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`);
    const { rows } = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    if ((rows[0] as { n: number }).n > 0) {
      console.log('Migration ledger already has entries; nothing to do');
      return;
    }
    await db.execute(sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${first.when})`);
    console.log(`Recorded ${first.tag} as applied`);
    return;
  }
  await migrate(db, { migrationsFolder: 'drizzle' });
  console.log('Migrations applied');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
