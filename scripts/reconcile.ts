// Reconciliation checks on real data (audit TECH-008): every screen and export must show the same totals
// as the stored lease results, and the statements must add up. Read only. Exits with code 1 on a break.
//
//   npx tsx scripts/reconcile.ts [versionId]                 screens (the loaders behind them)
//   npx tsx scripts/reconcile.ts [versionId] --app <url>     and the Excel exports of a running app
import 'dotenv/config';
import './allow-server-only';
import { eq, sql } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { db, schema } from '../src/db';
import { parseFilters } from '../src/lib/filters';
import { propertyRollups } from '../src/lib/budget/reports';
import { cashStatement, groupPnl, incomeStatement, summaryData } from '../src/lib/budget/summary';
import { loadDashboardData } from '../src/lib/budget/dashboard';
import { loadAnalysisData } from '../src/lib/budget/analysis';
import { loadPriorForecast } from '../src/lib/budget/forecast';
import { comparativeLabels, resolveComparatives } from '../src/lib/budget/comparatives';
import { loadBuildingOverheads } from '../src/lib/budget/boh';
import { propertyExpenses } from '../src/lib/budget/expenses';
import { BOH_ACCOUNT } from '../src/lib/budget/boh-types';
import { priorVersion } from '../src/lib/budget/prior-version';
import { signSession } from '../src/lib/auth/session';

const sum = (a: (number | null | undefined)[] | null | undefined) => (a ?? []).reduce<number>((s, v) => s + (v ?? 0), 0);
const results: { check: string; a: number; b: number; ok: boolean }[] = [];
const check = (name: string, a: number, b: number, tolerance = 1) => results.push({ check: name, a, b, ok: Math.abs(a - b) <= tolerance });

async function main() {
  const args = process.argv.slice(2);
  const app = args.includes('--app') ? args[args.indexOf('--app') + 1] : null;
  const id = Number(args.find((a) => /^\d+$/.test(a)));
  const versions = await db.select().from(schema.budgetVersions);
  const v = id ? versions.find((x) => x.id === id) : versions.filter((x) => !x.isBaseline).sort((a, b) => b.year - a.year || b.id - a.id)[0];
  if (!v) throw new Error('No version');
  const props = await db.select().from(schema.properties).where(eq(schema.properties.active, true));
  const ids = props.map((p) => p.id);
  const [admin] = await db.select().from(schema.users).where(eq(schema.users.role, 'ADMIN'));
  const user = { id: admin.id, name: admin.name, email: admin.email, role: admin.role, coordinator: admin.coordinator };
  const filters = parseFilters(undefined);

  // the stored results: what every screen should show
  const [stored] = (await db.execute(sql`select coalesce(sum(m.revenue), 0)::float rev, coalesce(sum(m.cash), 0)::float cash from line_monthly m join lease_lines l on l.id = m.line_id where l.version_id = ${v.id} and l.property_id in ${sql.raw(`(${ids.join(',')})`)}`)).rows as { rev: number; cash: number }[];

  // Lease Budget / Submissions (property roll-ups)
  const rolls = await propertyRollups(v.id, ids, []);
  check('Property roll-ups: rent = stored lease results', sum(rolls.map((r) => sum(r.revenue))), stored.rev);
  check('Property roll-ups: rent cash = stored lease results', sum(rolls.map((r) => sum(r.cash))), stored.cash);

  // Monthly Summary: income statement, cash flow, Group P&L
  const { atoms, expenses } = await summaryData(v.id, user, { filters, propertyIds: ids, categories: [] }, rolls);
  const is = incomeStatement(atoms, expenses);
  const cf = cashStatement(atoms, expenses);
  const pnl = groupPnl(atoms, expenses);
  check('Income statement: rental revenue = stored lease results', sum(is.find((l) => l.label === 'Rental revenue')?.vals), stored.rev);
  check('Cash flow: rent cheques = stored lease results', sum(cf.find((l) => l.label === 'Rent cheques (ex VAT)')?.vals), stored.cash);
  const n = pnl.inside.length;
  const netRow = pnl.rows.find((r) => r.label === 'Profit after tax (PAT)')!;
  check('Group P&L: eliminations net to nil in net income', netRow.vals[n + 2] ?? 0, 0);
  check('Group P&L net income = income statement net income', netRow.vals[n + 3] ?? 0, sum(is.find((l) => l.kind === 'total' && l.label.startsWith('Profit after tax (PAT)'))?.vals));
  for (const r of pnl.rows.filter((x) => x.kind !== 'group')) {
    const vals = r.vals.map((x) => x ?? 0);
    check(`Group P&L adds up: ${r.label}`, vals[n + 3], vals[n] + vals[n + 1] + vals[n + 2]);
    check(`Group P&L entities = standalone: ${r.label}`, sum(vals.slice(0, n)), vals[n]);
  }

  // Dashboard and Revenue Analysis
  const dash = await loadDashboardData(v, ids, filters);
  check('Dashboard: budget rent = stored lease results', sum(dash.units.map((u) => sum(u.revenue))), stored.rev);
  const prior = await priorVersion(v);
  if (prior) {
    const [p] = (await db.execute(sql`select coalesce(sum(m.revenue), 0)::float rev from line_monthly m join lease_lines l on l.id = m.line_id where l.version_id = ${prior.id} and l.property_id in ${sql.raw(`(${ids.join(',')})`)}`)).rows as { rev: number }[];
    check(`Dashboard: ${prior.year}B = stored results of ${prior.name}`, sum(dash.units.map((u) => sum(u.prior))), p.rev);
  }
  const ana = await loadAnalysisData(v, ids, new Set());
  check('Revenue Analysis: budget rent = stored lease results', sum(ana.units.map((u) => sum(u.budget))), stored.rev);

  // the one current-year forecast: Revenue Analysis comparatives = the forecast loader
  const f = await loadPriorForecast(v, ids);
  const fTotal = sum([...f.properties.values()].map((p) => sum(p.months)));
  const labels = await comparativeLabels(v);
  const comps = await resolveComparatives(v, labels, ids);
  check(`${f.label}: comparatives = forecast`, sum([...comps.values.values()].map((x) => x[f.label]?.amount ?? 0)), fTotal);

  // Building Overheads page = the building costs in the statements
  const boh = await loadBuildingOverheads(v, props, new Set());
  const bohLines = new Set([...BOH_ACCOUNT.values()].map((a) => a.line as string));
  const bohPage = sum(boh.blocks.map((b) => sum(b.rows.map((r) => r.b))));
  const bohStmt = sum((await propertyExpenses(v.id, ids)).filter((c) => bohLines.has(c.line)).map((c) => sum(c.months)));
  check('Building Overheads page = building overheads in the statements', bohPage, bohStmt);

  // the Excel exports of a running app (signed in as Admin, all filters off)
  if (app) {
    const token = await signSession({ uid: admin.id, role: admin.role, coordinator: admin.coordinator, name: admin.name, sv: admin.sessionVersion });
    const get = async (path: string) => {
      const r = await fetch(`${app}${path}`, { headers: { cookie: `session=${token}; flt=; vid=${v.id}` } });
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return XLSX.read(Buffer.from(await r.arrayBuffer()));
    };
    // the total column of the row with this label, in any sheet
    const rowTotal = (wb: XLSX.WorkBook, label: RegExp, sheet?: RegExp) => {
      for (const name of wb.SheetNames.filter((s) => !sheet || sheet.test(s))) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true });
        const head = rows.find((r) => r.includes('Total'));
        const ti = head ? head.indexOf('Total') : -1;
        const row = rows.find((r) => typeof r[0] === 'string' && label.test(r[0].trim()));
        if (row && ti >= 0) return Number(row[ti] ?? 0);
      }
      return NaN;
    };
    const summary = await get('/api/export/summary');
    check('Summary export: rental revenue', rowTotal(summary, /^Rental revenue$/), stored.rev);
    check('Summary export: rent cheques', rowTotal(summary, /^Rent cheques \(ex VAT\)$/), stored.cash);
    console.log(`(export sheets: ${summary.SheetNames.join(', ')})`);
  }

  const bad = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.check.padEnd(70)} ${r.a.toFixed(2).padStart(18)} ${r.b.toFixed(2).padStart(18)}`);
  console.log(`\n${v.name}: ${results.length - bad.length} of ${results.length} checks reconcile${bad.length ? `; ${bad.length} do not` : ''}`);
  if (bad.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
