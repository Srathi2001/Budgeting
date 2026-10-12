// A fixed series of saves through the app's own server actions (imports, Excel template round trips,
// schedules, assumptions, recalculation, submissions, lock and reopen), then a dump of every table. Run it
// with the old and the new code on two copies of the same database and compare the dumps with
// scripts/figures-compare.ts: a rewrite of the save paths must leave exactly the same data.
// WRITES: only against a throw-away copy (it refuses the usual local database on port 5433).
//
//   npx tsx scripts/save-scenario.ts <outDir> --copy [--lease <xlsx>] [--revenue <xlsx>] [--gl <xls>]...
import 'dotenv/config';
import './allow-server-only';
import { queryStats, setRequestCookies } from './request-shim';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import ExcelJS from 'exceljs';
import { db, schema } from '../src/db';
import { signSession, SESSION_COOKIE } from '../src/lib/auth/session';
import { VERSION_COOKIE } from '../src/lib/auth/dal';

const args = process.argv.slice(2);
const outDir = args[0];
const opt = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
if (!outDir || !args.includes('--copy')) throw new Error('Usage: tsx scripts/save-scenario.ts <outDir> --copy [--lease f] [--revenue f] [--gl f]...');
if (/:5433\//.test(process.env.DATABASE_URL ?? '')) throw new Error('This writes: point DATABASE_URL at a copy, not the local database on 5433');

const log: { step: string; result: unknown; queries: number; ms: number }[] = [];
async function step(name: string, f: () => Promise<unknown>) {
  const q0 = queryStats.count;
  const t0 = performance.now();
  let result: unknown;
  try {
    result = await f();
  } catch (e) {
    result = { thrown: e instanceof Error ? e.message : String(e) };
  }
  const ms = Math.round(performance.now() - t0);
  log.push({ step: name, result, queries: queryStats.count - q0, ms });
  console.log(`${name.padEnd(48)} ${String(queryStats.count - q0).padStart(6)} round trips ${String(ms).padStart(7)} ms`);
}

/**
 * Template edits a user would make: every 5th filled input cell nudged (+1 whole numbers, +0.01 otherwise);
 * a template without filled inputs gets every 9th empty input cell filled with 100.
 */
async function editTemplate(buf: ArrayBuffer, every = 5): Promise<File> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  let n = 0;
  wb.eachSheet((ws) =>
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.protection?.locked !== false || typeof cell.value !== 'number') return;
        if (n++ % every) return;
        cell.value = Number.isInteger(cell.value) ? cell.value + 1 : Math.round((cell.value + 0.01) * 1e6) / 1e6;
      }),
    ),
  );
  if (!n) {
    let m = 0;
    wb.eachSheet((ws) =>
      ws.eachRow((row) =>
        row.eachCell({ includeEmpty: true }, (cell) => {
          if (cell.protection?.locked !== false || (cell.value !== null && cell.value !== undefined && cell.value !== '')) return;
          if (m++ % 9 === 0) cell.value = 100;
        }),
      ),
    );
  }
  return new File([new Uint8Array(await wb.xlsx.writeBuffer())], 'upload.xlsx');
}

async function download(route: string, query = ''): Promise<ArrayBuffer> {
  const mod = (await import(`../src/app/api/export/${route}/route`)) as { GET: (r: Request) => Promise<Response> };
  const res = await mod.GET(new Request(`http://localhost/api/export/${route}${query ? '?' + query : ''}`));
  if (!res.ok) throw new Error(`${route}: ${res.status} ${await res.text()}`);
  return res.arrayBuffer();
}
const form = (entries: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const fileOf = (path: string) => new File([readFileSync(path)], basename(path));

/** Every table, rows in primary-key order, without timestamp columns (they differ run to run). */
async function dumpTables(dir: string) {
  mkdirSync(dir, { recursive: true });
  const tables = (await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).rows as { table_name: string }[];
  for (const { table_name: t } of tables) {
    const cols = (await db.execute(sql`select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = ${t} order by ordinal_position`)).rows as { column_name: string; data_type: string }[];
    const keep = cols.filter((c) => !c.data_type.startsWith('timestamp')).map((c) => `"${c.column_name}"`);
    const pk = (await db.execute(sql`select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = ${t}::regclass and i.indisprimary order by array_position(i.indkey, a.attnum)`)).rows as { attname: string }[];
    const order = pk.length ? pk.map((p) => `"${p.attname}"`).join(', ') : keep.join(', ');
    const rows = (await db.execute(sql.raw(`select ${keep.join(', ')} from "${t}" order by ${order}`))).rows;
    writeFileSync(join(dir, `table-${t}.json`), JSON.stringify(rows, (_, v) => (typeof v === 'bigint' ? String(v) : v), 1));
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const [version] = (await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.isBaseline, false))).sort((a, b) => b.year - a.year || b.id - a.id);
  const users = (await db.select().from(schema.users)).filter((u) => u.active).sort((a, b) => a.id - b.id);
  const admin = users.find((u) => u.role === 'ADMIN')!;
  const pm = users.find((u) => u.role === 'PM' && u.coordinator);
  const fmUser = users.find((u) => u.role === 'FM');
  const as = async (u: typeof admin) =>
    setRequestCookies({ [SESSION_COOKIE]: await signSession({ uid: u.id, role: u.role, coordinator: u.coordinator, name: u.name, sv: u.sessionVersion }), [VERSION_COOKIE]: String(version.id) });
  const v = version.id;

  const adminActions = await import('../src/app/(app)/admin/actions');
  const master = await import('../src/app/(app)/master/actions');
  const tpl = await import('../src/app/(app)/template-actions');
  const fm = await import('../src/app/(app)/fm/actions');
  const boh = await import('../src/app/(app)/building-overheads/actions');
  const subs = await import('../src/app/(app)/submissions/actions');
  const treasury = await import('../src/app/(app)/treasury/actions');
  const { loadInsurance, loadWatchmen, loadContracts } = await import('../src/lib/budget/boh-schedules');
  const { CONTRACT_KINDS } = await import('../src/lib/budget/boh-types');
  const { loadAsreBudget } = await import('../src/lib/budget/asre');
  const { loadTreasury } = await import('../src/lib/budget/treasury');
  const { withDefaults } = await import('../src/lib/engine/assumptions');
  const props = (await db.select().from(schema.properties).where(eq(schema.properties.active, true))).sort((a, b) => a.id - b.id);
  const ids = props.map((p) => p.id);

  await as(admin);
  // Oracle imports: lease report (preview, then apply the stored plan), revenue recognition, GL
  for (const f of opt('--lease'))
    await step('lease import', async () => {
      const p = await adminActions.previewLeaseImport(v, form({ file: fileOf(f), asOf: '2026-10-01' }));
      if (!p.planId) return p;
      return { preview: p.preview, apply: await adminActions.applyLeaseImport(p.planId) };
    });
  for (const f of opt('--revenue')) await step('revenue recognition import', () => adminActions.applyRevenueImportAction(form({ file: fileOf(f) })));
  for (const f of opt('--gl'))
    await step(`GL import ${basename(f)}`, async () => {
      const route = (await import('../src/app/api/import/gl/route')) as { POST: (r: Request) => Promise<Response> };
      const res = await route.POST(new Request(`http://localhost/api/import/gl?v=${v}&file=${encodeURIComponent(basename(f))}`, { method: 'POST', body: readFileSync(f), duplex: 'half' } as RequestInit));
      const body = (await res.json()) as { planId?: number };
      if (!body.planId) return body;
      return { preview: body, apply: await adminActions.applyGlActuals(body.planId, true) };
    });

  // Excel round trips: the input templates, the FM template and the lease template (Admin, then a PM)
  for (const kind of ['other-income', 'building-overheads', 'admin-overheads', 'fm-labour'])
    await step(`template ${kind}`, async () => tpl.uploadInputTemplate(kind, v, form({ file: await editTemplate(await download('input-template', `kind=${kind}`)) }), true));
  await step('template fm', async () => fm.uploadFmTemplate(v, form({ file: await editTemplate(await download('fm-template')) }), true));
  await step('template lease (admin)', async () => master.uploadTemplate(v, form({ file: await editTemplate(await download('template'), 9) }), true));
  if (pm) {
    await as(pm);
    await step('template lease (PM)', async () => master.uploadTemplate(v, form({ file: await editTemplate(await download('template'), 7) }), true));
    await as(admin);
  }

  // schedules and assumptions (Finance inputs, as Admin)
  await step('insurance', async () => boh.saveInsurance(v, (await loadInsurance(v, ids)).slice(0, 5).map((r) => ({ propertyId: r.propertyId, insuredValue: r.insuredValue === null ? null : r.insuredValue + 1000, parRate: r.parRate, plPremium: r.plPremium }))));
  await step('watchmen', async () => boh.saveWatchmen(v, [...(await loadWatchmen(v, ids))].slice(0, 5).map(([propertyId, share]) => ({ propertyId, share: Math.min(100, share + 1) }))));
  for (const k of CONTRACT_KINDS.slice(0, 3))
    await step(`contracts ${k.kind}`, async () => {
      const rows = (await loadContracts(v, ids, k.kind)).slice(0, 4) as unknown as Record<string, unknown>[];
      const lines: Record<string, unknown>[] = rows.map((r) => ({ ...r, rate: Number(r.rate ?? 0) + 1 }));
      lines.push({ id: null, propertyId: ids[0], account: k.accounts[0], supplier: 'Scenario', description: 'Scenario', terms: 'Monthly', quantity: 12, rate: 100, startMonth: 1, remarks: null });
      return boh.saveContracts(v, k.kind, { lines, deleted: [] });
    });
  await step('BOH assumptions', async () => {
    const a = withDefaults(version.assumptions);
    return boh.saveBohAssumptions(v, { bohUtilitiesPct: a.bohUtilitiesPct, insParPct: a.insParPct, insPlPct: a.insPlPct, watchmanCost: a.watchmanCost + 10 });
  });
  await step('ASRE', async () => {
    const values = await loadAsreBudget(v);
    const k = Object.keys(values)[0];
    return adminActions.saveAsre(v, k ? { ...values, [k]: (values[k] ?? 0) + 1 } : values);
  });
  await step('treasury', async () => {
    const out: unknown[] = [
      await treasury.saveTreasuryRecord(v, 'contingency', { id: null, entity: '501', description: 'Scenario', category: null, amount: 120000, phasing: 'EVEN', month: null, cash: true, notes: null }),
      await treasury.saveTreasuryRecord(v, 'contingency', { id: null, entity: '502', description: 'Scenario one-off', category: null, amount: 50000, phasing: 'MONTH', month: 6, cash: false, notes: null }),
    ];
    const t = (await loadTreasury(v)) as unknown as Record<string, { id: number }[]>;
    for (const [key, kind] of [['loans', 'loan'], ['deposits', 'deposit'], ['contingencies', 'contingency']] as const)
      for (const r of (t[key] ?? []).slice(0, 2)) out.push(await treasury.saveTreasuryRecord(v, kind, r));
    return out;
  });

  // assumptions (full recalculation), recalculation, submissions and FM approvals, lock and reopen
  await step('assumptions + recalculation', async () => {
    const [cur] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, v));
    const { DEFAULT_ASSUMPTIONS } = await import('../src/lib/engine/assumptions');
    const a = { ...DEFAULT_ASSUMPTIONS, ...(cur.assumptions as object) } as Record<string, unknown>;
    const keys = Object.keys(DEFAULT_ASSUMPTIONS);
    return adminActions.saveAssumptions(v, Object.fromEntries(keys.map((k) => [k, a[k]])) as never);
  });
  await step('recalculate version', () => adminActions.recalcVersion(v));
  const prop = props.find((p) => pm && p.coordinator === pm.coordinator) ?? props[0];
  if (pm) {
    await as(pm);
    await step('PM submits', () => subs.transition(v, prop.id, 'submit' as never, null));
    await as(admin);
    await step('Admin returns', () => subs.transition(v, prop.id, 'return' as never, 'scenario'));
  }
  if (fmUser) {
    const [fac] = await db.select().from(schema.fmLines).where(eq(schema.fmLines.versionId, v)).limit(1);
    if (fac) {
      await as(fmUser);
      await step('FM submits', () => fm.fmTransition(v, fac.propertyId, 'submit', null));
      await as(admin);
      await step('Admin approves FM', () => fm.fmTransition(v, fac.propertyId, 'approve', null));
    }
  }
  await step('lock', () => adminActions.setVersionStatus(v, 'LOCKED'));
  await step('reopen', () => adminActions.setVersionStatus(v, 'OPEN', 'scenario'));

  writeFileSync(join(outDir, 'steps.json'), JSON.stringify(log.map(({ step, result }) => ({ step, result })), null, 1));
  writeFileSync(join(outDir, 'metrics.json'), JSON.stringify(log.map(({ step, queries, ms }) => ({ file: step, queries, ms })), null, 1));
  await dumpTables(outDir);
  const submitted = await db.select().from(schema.submissions).where(and(eq(schema.submissions.versionId, v), eq(schema.submissions.propertyId, prop.id)));
  console.log(`done; submission of ${prop.code}: ${submitted[0]?.status ?? 'none'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  // close the pool before exiting: an abrupt disconnect jams the local PGlite database
  .finally(() => (db.$client as Pool).end());
