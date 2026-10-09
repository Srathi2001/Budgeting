import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireUser, isFinance, getActiveVersion, requireVersion } from '@/lib/auth/dal';
import { withDefaults } from '@/lib/engine/assumptions';
import { VersionsPanel, AssumptionsPanel, UsersPanel, PropertiesPanel, ComparativesPanel } from './panels';
import { PageHeader } from '@/components/ui/page-header';
import { RoutedTabs } from '@/components/ui/tabs';
import { Banner } from '@/components/ui/status';
import { comparativeLabels, resolveComparatives } from '@/lib/budget/comparatives';

async function ComparativesTab({ version }: { version: schema.BudgetVersion }) {
  const labels = await comparativeLabels(version);
  const props = await db.select().from(schema.properties).where(eq(schema.properties.active, true)).orderBy(asc(schema.properties.buCode), asc(schema.properties.code));
  const { values } = await resolveComparatives(
    version,
    labels,
    props.map((p) => p.id),
  );
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
  ['versions', 'Budget versions'],
  ['assumptions', 'Assumptions'],
  ['comparatives', 'Comparatives'],
  ['properties', 'Properties'],
  ['users', 'Users'],
] as const;

export default async function AdminPage(props: PageProps<'/admin'>) {
  const user = await requireUser();
  const sp = await props.searchParams;
  if (!isFinance(user))
    return (
      <div className="anh-main">
        <Banner kind="warning" title="Finance access required">
          Admin is for Finance. Ask a Finance user if something here needs changing.
        </Banner>
      </div>
    );
  // the former import tabs (imports, fusion, revenue, gl) now live on their own page
  if (sp.tab === 'imports' || sp.tab === 'fusion' || sp.tab === 'revenue' || sp.tab === 'gl') redirect('/imports');
  const { version: maybeVersion, all } = await getActiveVersion();
  const version = maybeVersion ?? (await requireVersion());
  const v = version;
  const tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? 'versions') as (typeof TABS)[number][0];

  return (
    <div className="anh-main">
      <PageHeader
        eyebrow="Admin"
        title="Admin"
        sub={`${v.name} · versions, assumptions, comparatives, properties and users`}
        tabs={
          <RoutedTabs
            ariaLabel="Admin sections"
            tabs={[...TABS.map(([k, label]) => ({ href: k === 'versions' ? '/admin' : `/admin?tab=${k}`, label, param: { name: 'tab', value: k === 'versions' ? null : k } })), { href: '/design', label: 'Design preview' }]}
          />
        }
      />

      {tab === 'versions' && <VersionsPanel versions={all.map((x) => ({ id: x.id, name: x.name, year: x.year, status: x.status, isBaseline: x.isBaseline, createdAt: x.createdAt.toISOString() }))} />}
      {tab === 'assumptions' && <AssumptionsPanel versionId={v.id} versionName={v.name} locked={v.status === 'LOCKED'} assumptions={withDefaults(v.assumptions)} />}
      {tab === 'comparatives' && <ComparativesTab version={v} />}
      {tab === 'properties' && <PropertiesPanel rows={await db.select().from(schema.properties).orderBy(asc(schema.properties.buCode), asc(schema.properties.code))} />}
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
