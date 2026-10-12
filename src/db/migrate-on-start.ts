// Applies the migrations in ./drizzle when a server starts (instrumentation.ts, MIGRATE_ON_START=1). Several
// app instances starting together take turns (an advisory lock); the migrator skips what it already
// applied (its ledger in drizzle.__drizzle_migrations), so a restart changes nothing.
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './index';

const MIGRATION_LOCK = 7330;

export async function migrateOnStart() {
  const client = await db.$client.connect();
  try {
    await client.query('select pg_advisory_lock($1::int, 0)', [MIGRATION_LOCK]);
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), 'drizzle') });
    console.log('Database migrations applied');
  } finally {
    await client.query('select pg_advisory_unlock($1::int, 0)', [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
}
