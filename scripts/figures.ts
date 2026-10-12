// Records what every screen and Excel export shows, so a change can be checked for "no figure moved":
// run it before and after, then compare the two folders with scripts/figures-compare.ts. Read only.
//
//   npx tsx scripts/figures.ts <outDir> [versionId,...]
//
// One JSON file per version, user role and loader (Admin, Finance, a PM and an FM user; all filters, plus
// one business-unit and one category filter for Admin). metrics.json has each loader's database round trips
// and time; with SIM_LATENCY_MS=2 every round trip is delayed as if the database were across the network.
import 'dotenv/config';
import './allow-server-only';
import { queryStats, setRequestCookies } from './request-shim';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import * as XLSX from 'xlsx';
import { db, schema } from '../src/db';
import { signSession, SESSION_COOKIE } from '../src/lib/auth/session';
import { VERSION_COOKIE } from '../src/lib/auth/dal';
import { visibleProperties, editablePropertyIds, isFinance, type Actor } from '../src/lib/auth/permissions';
import { FILTER_COOKIE, NO_FILTERS, type Filters } from '../src/lib/filters';
import { filterBusinessUnits, filterUniverse, filteredScope } from '../src/lib/filters-server';
import { getSettings } from '../src/lib/settings';
import { scriptScope } from '../src/lib/request-memo';
import { loadHome } from '../src/lib/budget/home';
import { loadDashboardData } from '../src/lib/budget/dashboard';
import { loadDashboardReports } from '../src/lib/budget/dashboard-reports';
import { loadLeaseSummary } from '../src/lib/budget/lease-summary';
import { loadMasterRows } from '../src/lib/budget/master';
import { propertyRollups } from '../src/lib/budget/reports';
import { budgetedExpenseLines, propertyExpenses, propertyExpenseTotals } from '../src/lib/budget/expenses';
import { cashStatement, groupPnl, incomeStatement, summaryData } from '../src/lib/budget/summary';
import { loadAnalysisData } from '../src/lib/budget/analysis';
import { loadTreasury, treasuryForStatements } from '../src/lib/budget/treasury';
import { loadOtherIncome } from '../src/lib/budget/other-income';
import { loadBuildingOverheads } from '../src/lib/budget/boh';
import { loadContracts, loadInsurance, loadWatchmen } from '../src/lib/budget/boh-schedules';
import { CONTRACT_KINDS } from '../src/lib/budget/boh-types';
import { loadFmSummary } from '../src/lib/budget/fm-summary';
import { loadFmPage } from '../src/lib/budget/fm-page';
import { loadAdminSummary } from '../src/lib/budget/admin-summary';
import { adminEntityCosts, landlordRent, loadAdminOverheads, managementFees } from '../src/lib/budget/admin';
import { comparativeLabels, resolveComparatives } from '../src/lib/budget/comparatives';
import { loadAsreBudget } from '../src/lib/budget/asre';
import { loadPriorForecast } from '../src/lib/budget/forecast';

/** Sets, Maps, Dates and -0 in a stable, comparable form; object keys sorted. */
function normalize(x: unknown): unknown {
  if (x === undefined) return undefined;
  if (x === null || typeof x === 'string' || typeof x === 'boolean') return x;
  if (typeof x === 'number') return Number.isNaN(x) ? 'NaN' : Object.is(x, -0) ? 0 : x;
  if (typeof x === 'bigint') return String(x);
  if (x instanceof Date) return x.toISOString();
  if (x instanceof Uint8Array) return `<${x.length} bytes>`;
  if (x instanceof Set) return [...x].map(normalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (x instanceof Map) return [...x.entries()].map(([k, v]) => [normalize(k), normalize(v)]).sort((a, b) => JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])));
  if (Array.isArray(x)) return x.map((v) => (v === undefined ? null : normalize(v)));
  if (typeof x === 'function') return '<function>';
  const o = x as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    const v = normalize(o[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** An Excel export as cell values and formulas per sheet. */
function workbookCells(buf: ArrayBuffer) {
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellFormula: true, cellDates: false });
  const out: Record<string, Record<string, unknown>> = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const cells: Record<string, unknown> = {};
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith('!')) continue;
      const c = ws[addr] as XLSX.CellObject;
      cells[addr] = c.f ? { f: c.f, v: c.v } : c.v;
    }
    out[name] = cells;
  }
  return out;
}

const metrics: { file: string; queries: number; ms: number; error?: string }[] = [];

async function main() {
  const [outDir, only] = process.argv.slice(2);
  if (!outDir) throw new Error('Usage: tsx scripts/figures.ts <outDir> [versionId,...]');
  mkdirSync(outDir, { recursive: true });
  const wanted = only ? new Set(only.split(',').map(Number)) : null;
  const versions = (await db.select().from(schema.budgetVersions)).filter((v) => !v.isBaseline && (!wanted || wanted.has(v.id))).sort((a, b) => a.id - b.id);
  const users = (await db.select().from(schema.users)).filter((u) => u.active).sort((a, b) => a.id - b.id);
  const sample = (['ADMIN', 'FINANCE', 'PM', 'FM'] as const).map((role) => users.find((u) => u.role === role && (role !== 'PM' || u.coordinator))).filter((u) => !!u);

  for (const v of versions) {
    for (const u of sample) {
      const user: Actor = { id: u.id, name: u.name, email: u.email, role: u.role, coordinator: u.coordinator };
      const token = await signSession({ uid: u.id, role: u.role, coordinator: u.coordinator, name: u.name, sv: u.sessionVersion });
      const runs: { tag: string; filters: Filters }[] = [{ tag: 'all', filters: NO_FILTERS }];
      if (u.role === 'ADMIN') {
        setRequestCookies({ [SESSION_COOKIE]: token, [VERSION_COOKIE]: String(v.id) });
        const universe = await filterUniverse(user);
        const bu = universe[0]?.bu;
        const cat = universe.flatMap((p) => p.categories)[0];
        if (bu) runs.push({ tag: `bu-${bu}`, filters: { ...NO_FILTERS, bu: [bu] } });
        if (cat) runs.push({ tag: `cat-${cat}`, filters: { ...NO_FILTERS, cat: [cat] } });
      }
      for (const run of runs) {
        setRequestCookies({ [SESSION_COOKIE]: token, [VERSION_COOKIE]: String(v.id), [FILTER_COOKIE]: JSON.stringify(run.filters) });
        // every loader of this run shares results as one page request does (request-memo.ts), more widely
        scriptScope.map = process.env.FIGURES_NO_MEMO ? null : new Map();
        const prefix = `v${v.id}-${u.role}-${run.tag}`;
        const record = async (name: string, f: () => Promise<unknown>) => {
          const file = `${prefix}-${name}.json`;
          const q0 = queryStats.count;
          const t0 = performance.now();
          try {
            const value = await f();
            writeFileSync(join(outDir, file), JSON.stringify(normalize(value), null, 1));
            metrics.push({ file, queries: queryStats.count - q0, ms: Math.round(performance.now() - t0) });
          } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            writeFileSync(join(outDir, file), JSON.stringify({ error }, null, 1));
            metrics.push({ file, queries: queryStats.count - q0, ms: Math.round(performance.now() - t0), error });
          }
        };

        const props = await visibleProperties(user);
        const ids = props.map((p) => p.id);
        const editPM = await editablePropertyIds(user, v, 'PM');
        const editFIN = await editablePropertyIds(user, v, 'FIN');
        const scope = await filteredScope(user);
        const all = run.tag === 'all';

        await record('access', async () => ({ visible: ids, editPM, editFIN, universe: await filterUniverse(user), bus: await filterBusinessUnits(user), scope }));
        await record('home', () => loadHome(user, v));
        await record('dashboard-data', () => loadDashboardData(v, ids, scope.filters));
        await record('dashboard-reports', () => loadDashboardReports(v, user, scope));
        await record('lease-summary', () => loadLeaseSummary(v, scope.propertyIds, scope.categories, scope.filters));
        await record('master-rows', () => loadMasterRows(v.id, { propertyIds: scope.propertyIds, editableProperties: editPM }));
        await record('rollups', () => propertyRollups(v.id, scope.propertyIds, scope.categories));
        await record('pnl', async () => ({ budgeted: await budgetedExpenseLines(v.id), totals: await propertyExpenseTotals(v.id, scope.propertyIds), expenses: await propertyExpenses(v.id, scope.propertyIds) }));
        await record('summary', async () => {
          const rolls = await propertyRollups(v.id, scope.propertyIds, scope.categories);
          const { atoms, expenses } = await summaryData(v.id, user, scope, rolls);
          return { atoms, expenses, is: incomeStatement(atoms, expenses), cf: cashStatement(atoms, expenses), group: groupPnl(atoms, expenses) };
        });
        if (!all) continue; // the input pages and the rest don't take the shared filters
        await record('analysis', async () => loadAnalysisData(v, ids, isFinance(user) ? new Set(ids) : editPM));
        await record('treasury', async () => ({ page: await loadTreasury(v.id), statements: await treasuryForStatements(v) }));
        await record('other-income', () => loadOtherIncome(v, user, props, editPM));
        await record('boh', () => loadBuildingOverheads(v, props, editPM, editFIN));
        await record('boh-schedules', async () => ({
          insurance: await loadInsurance(v.id, ids),
          watchmen: await loadWatchmen(v.id, ids),
          contracts: Object.fromEntries(await Promise.all(CONTRACT_KINDS.map(async (k) => [k.kind, await loadContracts(v.id, ids, k.kind)] as const))),
        }));
        await record('fm-summary', () => loadFmSummary(v, user, scope.propertyIds));
        await record('fm-page', async () => {
          const page = await loadFmPage(v, user, scope.propertyIds, null);
          const first = page.facilities[0] as unknown as { id?: number; propertyId?: number } | undefined;
          const sel = first?.id ?? first?.propertyId ?? null;
          return { page, detail: sel ? await loadFmPage(v, user, scope.propertyIds, sel) : null };
        });
        await record('admin-summary', () => loadAdminSummary(v));
        await record('admin-overheads', () => loadAdminOverheads(v));
        await record('admin-parts', async () => ({ costs: await adminEntityCosts(v), fees: await managementFees(v), rent: await landlordRent(v.id) }));
        await record('comparatives', async () => {
          const labels = await comparativeLabels(v);
          return { labels, values: await resolveComparatives(v, labels, ids) };
        });
        await record('asre', () => loadAsreBudget(v.id));
        await record('settings', () => getSettings());
        await record('prior-forecast', () => loadPriorForecast(v, ids));

        // the Excel exports, as a browser downloads them
        const exports: [string, string][] = [
          ['master', ''],
          ['comparatives', ''],
          ['analysis', ''],
          ['summary', ''],
          ['fm-template', ''],
          ['pnl', ''],
          ['other-income', ''],
          ['template', ''],
          ...['other-income', 'building-overheads', 'admin-overheads', 'fm-labour'].map((k) => ['input-template', `kind=${k}`] as [string, string]),
        ];
        if (ids[0]) exports.push(['master', `p=${ids[0]}`], ['template', `p=${ids[0]}`]);
        for (const [route, query] of exports) {
          await record(`export-${route}${query ? '-' + query.replace(/[=&]/g, '_') : ''}`, async () => {
            const mod = (await import(`../src/app/api/export/${route}/route`)) as { GET: (r: Request) => Promise<Response> };
            const res = await mod.GET(new Request(`http://localhost/api/export/${route}${query ? '?' + query : ''}`));
            if (!res.ok) return { status: res.status, body: await res.text() };
            return { status: res.status, disposition: res.headers.get('Content-Disposition'), cells: workbookCells(await res.arrayBuffer()) };
          });
        }
      }
    }
  }
  writeFileSync(join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 1));
  const total = metrics.reduce((s, m) => ({ q: s.q + m.queries, ms: s.ms + m.ms }), { q: 0, ms: 0 });
  console.log(`${metrics.length} files, ${metrics.filter((m) => m.error).length} errors, ${total.q} round trips, ${(total.ms / 1000).toFixed(1)} s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  // close the pool before exiting: an abrupt disconnect jams the local PGlite database
  .finally(() => (db.$client as Pool).end());
