// Runs once when a server starts. On Azure (MIGRATE_ON_START=1) the database migrations are applied here,
// from inside the private network the database lives in; locally nothing happens (npm run db:migrate).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.MIGRATE_ON_START !== '1') return;
  const { migrateOnStart } = await import('./db/migrate-on-start');
  await migrateOnStart();
}
