// Local Postgres for development when a real server isn't available: PGlite (Postgres compiled to
// WASM) served over the normal Postgres wire protocol on 127.0.0.1:5433, data in ./.pgdata.
// PGlite is a single session, so run the app with DB_POOL_MAX=1 against it.
//
// PGlite has no crash recovery: a hard stop (closed window, killed process) can leave .pgdata
// unopenable. So this launcher keeps itself recoverable:
// - a CHECKPOINT every minute, and a consistent snapshot of the whole database every
//   DEV_DB_SNAPSHOT_MINUTES (default 10) when something changed, plus one on a clean stop,
//   kept in ./.pgdata-snapshots (the newest DEV_DB_SNAPSHOTS_KEPT, default 36);
// - on start, if .pgdata won't open, it is moved aside and the newest snapshot restored.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const port = Number(process.env.DEV_DB_PORT ?? 5433);
const DATA = process.env.DEV_DB_DATA ?? './.pgdata';
const SNAPS = process.env.DEV_DB_SNAPSHOTS ?? './.pgdata-snapshots';
const every = Number(process.env.DEV_DB_SNAPSHOT_MINUTES ?? 10);
const keep = Number(process.env.DEV_DB_SNAPSHOTS_KEPT ?? 36);
// local time, sortable: 20261006-112846
const stamp = () => new Date().toLocaleString('sv-SE').replace(/[-:]/g, '').replace(' ', '-').slice(0, 15);
const log = (m: string) => console.log(`${new Date().toLocaleTimeString('en-GB')} ${m}`);

const snapshots = () =>
  existsSync(SNAPS)
    ? readdirSync(SNAPS)
        .filter((f) => /^snapshot-.*\.tar\.gz$/.test(f))
        .sort()
        .map((f) => join(SNAPS, f))
    : [];

/** Opens .pgdata; if it is damaged, moves it aside and restores the newest snapshot. */
async function open(): Promise<PGlite> {
  if (existsSync(DATA)) {
    try {
      const db = await PGlite.create(DATA);
      await db.query('select 1');
      return db;
    } catch (e) {
      const aside = `${DATA}-damaged-${stamp()}`;
      log(`.pgdata won't open (${(e as Error).message.slice(0, 120)}); moved to ${aside}`);
      renameSync(DATA, aside);
    }
  }
  const latest = snapshots().at(-1);
  if (!latest) {
    log('No snapshot to restore: starting an empty database (run db:push and the imports)');
    return PGlite.create(DATA);
  }
  log(`Restoring ${latest} (${statSync(latest).mtime.toLocaleString('en-GB')})`);
  const db = await PGlite.create({ dataDir: DATA, loadDataDir: new Blob([readFileSync(latest)]) });
  await db.query('select 1');
  return db;
}

async function main() {
  const db = await open();
  mkdirSync(SNAPS, { recursive: true });

  let lastLsn = '';
  let busy = false;
  const snapshot = async (why: string) => {
    if (busy) return;
    busy = true;
    try {
      const { rows } = await db.query<{ lsn: string }>('select pg_current_wal_lsn()::text as lsn');
      if (rows[0].lsn === lastLsn && why === 'scheduled') return; // nothing changed
      await db.exec('CHECKPOINT');
      const blob = await db.dumpDataDir('gzip');
      const file = join(SNAPS, `snapshot-${stamp()}.tar.gz`);
      writeFileSync(`${file}.part`, Buffer.from(await blob.arrayBuffer()));
      renameSync(`${file}.part`, file); // a half-written snapshot never looks complete
      lastLsn = rows[0].lsn;
      for (const old of snapshots().slice(0, -keep)) rmSync(old);
      log(`Snapshot (${why}): ${file}`);
    } catch (e) {
      log(`Snapshot failed: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  };

  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 20 });
  await server.start();
  log(`PGlite listening on postgres://postgres:postgres@127.0.0.1:${port}/postgres`);
  await snapshot('start');

  const checkpoints = setInterval(() => void db.exec('CHECKPOINT').catch(() => undefined), 60_000);
  const timer = setInterval(() => void snapshot('scheduled'), every * 60_000);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(checkpoints);
    clearInterval(timer);
    await server.stop();
    await snapshot('stop');
    await db.close();
    log('Stopped cleanly');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  // Optional clean shutdown after N minutes, for runners that hard-kill long processes: DEV_DB_MAX_MINUTES=115
  const max = Number(process.env.DEV_DB_MAX_MINUTES ?? 0);
  if (max > 0) {
    log(`Will stop cleanly after ${max} minutes`);
    setTimeout(stop, max * 60_000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
