import Link from 'next/link';
import { asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireUser, isFinance, getActiveVersion } from '@/lib/auth/dal';
import { withDefaults } from '@/lib/engine/assumptions';
import { fmtDateTime } from '@/lib/format';
import { VersionsPanel, AssumptionsPanel, UsersPanel, PropertiesPanel, ComparativesPanel, LeaseImportPanel, GlImportPanel, RevenueImportPanel } from './panels';
import { lastActualMonth } from '@/lib/import/revenue-recognition';
import { GL_LEDGERS, GL_LEDGER_NAMES } from '@/lib/import/gl-other-income';

/** Every Oracle report the tool imports, in one tab: what to run, with which parameters, and where it goes. */
async function ImportsTab({ version }: { version: schema.BudgetVersion }) {
  const Y = version.year;
  const yy = (n: number) => String(n).slice(2);
  const lastOf = (r: { at: string; file: string | null } | undefined) => (r ? { at: String(r.at), file: r.file } : null);

  const { rows: leaseRows } = await db.execute(sql`
    select count(*)::int as lines,
      count(*) filter (where l.current_end is not null)::int as leased,
      (select json_build_object('at', at, 'file', changes->>'file') from audit_log
        where entity = 'lease_import' and version_id = ${version.id} order by at desc limit 1) as last
    from lease_lines l where l.version_id = ${version.id}`);
  const s = leaseRows[0] as { lines: number; leased: number; last: { at: string; file: string | null } | null };
  const { rows: revRows } = await db.execute(sql`
    select at, changes->>'file' as file from audit_log where entity = 'revenue_import' order by at desc limit 1`);
  const revLast = revRows[0] as { at: string; file: string | null } | undefined;
  const revTo = await lastActualMonth();
  // the last import of each ledger
  const { rows: glRows } = await db.execute(sql`
    select distinct on (changes->>'ledger') changes->>'ledger' as ledger, at, changes->>'file' as file from audit_log
    where entity = 'gl_import' and version_id = ${version.id} order by changes->>'ledger', at desc`);
  const glLast = new Map((glRows as { ledger: string; at: string; file: string | null }[]).map((r) => [r.ledger, r]));

  const REPORTS = [
    {
      id: 'lease',
      name: 'Tenant and Lease Details Report',
      where: 'Oracle: Custom Applications → Lease Reports → Reports',
      params: 'All business units · .xlsx. With it (optional): REHL+MJN+PMC (dd-mm-yyyy) - Unit Dump.xls and Maintenance Fee Report.xls',
      feeds: 'Lease Budget: units, current leases',
    },
    {
      id: 'revenue',
      name: 'Revenue Recognition Summary',
      where: 'Oracle: Property Manager → Revenue Recognition Summary',
      params: `Accounting periods Jan-${Y - 3} to the last closed month`,
      feeds: 'Revenue Analysis: rent actuals',
    },
    ...GL_LEDGER_NAMES.map((ledger, i) => ({
      id: `gl-${i + 1}`,
      name: `Account Analysis Report (not "Account Wise Analysis Report")`,
      where: 'Oracle: General Ledger',
      params: `Ledger or Ledger Set ${ledger} · Period From Jan-${yy(Y - 3)} To Sep-${yy(Y - 1)} · Balance Type Actual · Account starts with 52`,
      feeds: 'Other Income: GL actuals',
    })),
  ];

  return (
    <div className="space-y-6">
      <div className="frame">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th>Oracle report</th>
              <th>Where</th>
              <th>Parameters</th>
              <th>Goes to</th>
            </tr>
          </thead>
          <tbody>
            {REPORTS.map((r, i) => (
              <tr key={r.id}>
                <td className="muted">{i + 1}</td>
                <td>
                  <a href={`#${r.id}`} className="font-semibold hover:underline">
                    {r.name}
                  </a>
                </td>
                <td className="muted">{r.where}</td>
                <td>{r.params}</td>
                <td className="muted">{r.feeds}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div id="lease" className="scroll-mt-4">
        <LeaseImportPanel
          versionId={version.id}
          versionName={version.name}
          locked={version.status === 'LOCKED'}
          stats={{
            lines: s.lines,
            leased: s.leased,
            lastImport: s.last ? fmtDateTime(s.last.at) : null,
            lastFile: s.last?.file ?? null,
          }}
        />
      </div>
      <div id="revenue" className="scroll-mt-4">
        <RevenueImportPanel year={Y} last={revLast ? { ...lastOf(revLast)!, to: revTo } : null} />
      </div>
      {GL_LEDGER_NAMES.map((ledger, i) => (
        <div key={ledger} id={`gl-${i + 1}`} className="scroll-mt-4">
          <GlImportPanel
            ledger={ledger}
            companies={Object.keys(GL_LEDGERS[ledger].companies)}
            versionId={version.id}
            versionName={version.name}
            year={Y}
            locked={version.status === 'LOCKED'}
            last={lastOf(glLast.get(ledger))}
          />
        </div>
      ))}
    </div>
  );
}
import { comparativeLabels, resolveComparatives } from '@/lib/budget/comparatives';

async function ComparativesTab({ version }: { version: schema.BudgetVersion }) {
  const labels = await comparativeLabels(version);
  const props = await db.select().from(schema.properties).where(eq(schema.properties.active, true)).orderBy(asc(schema.properties.buCode), asc(schema.properties.code));
  const { values } = await resolveComparatives(version, labels, props.map((p) => p.id));
  return (
    <ComparativesPanel
      versionId={version.id}
      versionName={version.name}
      labels={labels}
      locked={version.status === 'LOCKED'}
      rows={props.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        bu: p.buCode,
        values: Object.fromEntries(labels.map((l) => [l, values.get(p.id)?.[l]?.amount ?? null])),
        sources: Object.fromEntries(labels.map((l) => [l, values.get(p.id)?.[l]?.source ?? 'manual'])),
      }))}
    />
  );
}

export const metadata = { title: 'Admin · Budget' };

const TABS = [
  ['imports', 'Imports'],
  ['versions', 'Budget versions'],
  ['assumptions', 'Assumptions'],
  ['comparatives', 'Comparatives'],
  ['properties', 'Properties'],
  ['users', 'Users'],
] as const;

export default async function AdminPage(props: PageProps<'/admin'>) {
  const user = await requireUser();
  if (!isFinance(user)) return <div className="p-6 text-slate-600">Finance access required.</div>;
  const { version, all } = await getActiveVersion();
  const v = version!;
  const sp = await props.searchParams;
  // the former import tabs (fusion, revenue, gl) now open Imports
  const tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? 'imports') as (typeof TABS)[number][0];

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center gap-4">
        <h1 className="text-xl font-semibold">Admin</h1>
        <nav className="flex gap-1">
          {TABS.map(([k, label]) => (
            <Link key={k} href={`/admin?tab=${k}`} className={k === tab ? 'btn-primary' : 'btn'}>
              {label}
            </Link>
          ))}
        </nav>
      </header>

      {tab === 'versions' && (
        <VersionsPanel
          versions={all.map((x) => ({ id: x.id, name: x.name, year: x.year, status: x.status, isBaseline: x.isBaseline, createdAt: x.createdAt.toISOString() }))}
        />
      )}
      {tab === 'assumptions' && (
        <AssumptionsPanel versionId={v.id} versionName={v.name} locked={v.status === 'LOCKED'} assumptions={withDefaults(v.assumptions)} />
      )}
      {tab === 'comparatives' && <ComparativesTab version={v} />}
      {tab === 'imports' && <ImportsTab version={v} />}
      {tab === 'properties' && (
        <PropertiesPanel rows={await db.select().from(schema.properties).orderBy(asc(schema.properties.buCode), asc(schema.properties.code))} />
      )}
      {tab === 'users' && (
        <UsersPanel
          isAdmin={user.role === 'ADMIN'}
          rows={(await db.select().from(schema.users).orderBy(asc(schema.users.role), asc(schema.users.name))).map((u) => ({
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role,
            coordinator: u.coordinator,
            active: u.active,
          }))}
        />
      )}
    </div>
  );
}
