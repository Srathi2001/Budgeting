import Link from 'next/link';
import { asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireUser, isFinance, getActiveVersion } from '@/lib/auth/dal';
import { withDefaults } from '@/lib/engine/assumptions';
import { VersionsPanel, AssumptionsPanel, ReraPanel, UsersPanel, PropertiesPanel, ComparativesPanel, LeaseImportPanel } from './panels';

async function LeaseDataTab({ version }: { version: schema.BudgetVersion }) {
  const { rows } = await db.execute(sql`
    select count(*)::int as lines,
      count(*) filter (where l.current_end is not null)::int as leased,
      (select json_build_object('at', at, 'file', changes->>'file') from audit_log
        where entity = 'lease_import' and version_id = ${version.id} order by at desc limit 1) as last
    from lease_lines l where l.version_id = ${version.id}`);
  const s = rows[0] as { lines: number; leased: number; last: { at: string; file: string | null } | null };
  return (
    <LeaseImportPanel
      versionId={version.id}
      versionName={version.name}
      locked={version.status === 'LOCKED'}
      stats={{
        lines: s.lines,
        leased: s.leased,
        lastImport: s.last ? new Date(s.last.at).toLocaleString('en-GB', { timeZone: 'Asia/Dubai' }) : null,
        lastFile: s.last?.file ?? null,
      }}
    />
  );
}
import { comparativeLabels } from '@/lib/budget/comparatives';

async function ComparativesTab({ version }: { version: schema.BudgetVersion }) {
  const labels = await comparativeLabels(version);
  const props = await db.select().from(schema.properties).where(eq(schema.properties.active, true)).orderBy(asc(schema.properties.buCode), asc(schema.properties.code));
  const comps = await db.select().from(schema.comparatives).where(eq(schema.comparatives.versionId, version.id));
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
        values: Object.fromEntries(labels.map((l) => [l, comps.find((c) => c.propertyId === p.id && c.label === l)?.amount ?? null])),
      }))}
    />
  );
}

export const metadata = { title: 'Admin · Budget' };

const TABS = [
  ['fusion', 'Lease data'],
  ['versions', 'Budget versions'],
  ['assumptions', 'Assumptions'],
  ['rera', 'RERA index'],
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
  const tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? 'fusion') as (typeof TABS)[number][0];

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
      {tab === 'rera' && (
        <ReraPanel
          versionId={v.id}
          versionName={v.name}
          locked={v.status === 'LOCKED'}
          rows={await db
            .select()
            .from(schema.reraIndex)
            .where(eq(schema.reraIndex.versionId, v.id))
            .orderBy(asc(schema.reraIndex.propertyCode), asc(schema.reraIndex.bedroom))}
          properties={await db.select({ code: schema.properties.code, name: schema.properties.name }).from(schema.properties).orderBy(asc(schema.properties.code))}
        />
      )}
      {tab === 'comparatives' && <ComparativesTab version={v} />}
      {tab === 'fusion' && <LeaseDataTab version={v} />}
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
