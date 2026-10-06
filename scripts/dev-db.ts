// Local Postgres for development when Docker isn't available: PGlite (Postgres compiled to WASM)
// served over the normal Postgres wire protocol on 127.0.0.1:5433, data persisted in ./.pgdata.
// PGlite is a single session, so run the app with DB_POOL_MAX=1 against it.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const port = Number(process.env.DEV_DB_PORT ?? 5433);

async function main() {
  const db = await PGlite.create('./.pgdata');
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 20 });
  await server.start();
  console.log(`PGlite listening on postgres://postgres:postgres@127.0.0.1:${port}/postgres`);
  const stop = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  // Optional clean shutdown after N minutes, for runners that hard-kill long processes
  // (a hard kill can leave the data folder corrupt): DEV_DB_MAX_MINUTES=115
  const max = Number(process.env.DEV_DB_MAX_MINUTES ?? 0);
  if (max > 0) {
    console.log(`Will stop cleanly after ${max} minutes`);
    setTimeout(stop, max * 60_000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
