import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const globalForDb = globalThis as unknown as { pool?: Pool };

// how long a save waits for another user's save of the same figures before giving up
export const LOCK_WAIT_MS = 10_000;

function createPool() {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    // keep connections open between requests: a new one costs a TLS handshake and a login (Azure)
    idleTimeoutMillis: 60_000,
    // a database that can't be reached fails the request instead of hanging it
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    // statements and lock waits are bounded: a blocked save says so instead of waiting forever
    lock_timeout: LOCK_WAIT_MS,
    statement_timeout: 120_000,
  });
  // a dropped idle connection (network blip, database restart) must not stop the app
  p.on('error', (e) => console.error('Database connection error:', e.message));
  return p;
}

// Reuse one pool across hot reloads in development
const pool = globalForDb.pool ?? createPool();
if (process.env.NODE_ENV !== 'production') globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
export type DB = typeof db;
export { schema };

const pgCode = (e: unknown): string | undefined => {
  for (let x = e as { code?: string; cause?: unknown } | undefined, i = 0; x && i < 5; x = x.cause as typeof x, i++) if (typeof x.code === 'string') return x.code;
  return undefined;
};

// A save that waited LOCK_WAIT_MS for another one (55P03), or that collided with one (deadlock 40P01,
// serialization failure 40001), was undone completely by the database: the user gets a plain message.
const COLLIDED: Record<string, string> = {
  '55P03': 'Someone else is saving the same figures right now: nothing was saved, please save again in a moment',
  '40P01': 'This save collided with another one: nothing was saved, please save again',
  '40001': 'This save collided with another one: nothing was saved, please save again',
};
const begin = db.transaction.bind(db);
db.transaction = (async (fn: Parameters<typeof begin>[0], config?: Parameters<typeof begin>[1]) => {
  try {
    return await begin(fn, config);
  } catch (e) {
    const msg = COLLIDED[pgCode(e) ?? ''];
    if (msg) throw new Error(msg, { cause: e });
    throw e;
  }
}) as typeof db.transaction;
