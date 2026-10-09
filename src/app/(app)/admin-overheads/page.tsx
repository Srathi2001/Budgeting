import { RoutedTabs } from '@/components/ui/tabs';
import { requireUser, isFinance, requireVersion } from '@/lib/auth/dal';
import { loadAdminOverheads } from '@/lib/budget/admin';
import { ITEM_KINDS, isItemKind, type ItemKind } from '@/lib/budget/admin-items';
import { AdminOverheads } from './admin-overheads';
import { AdminSchedule } from './admin-schedule';
import { TemplateButtons } from '@/components/template-buttons';
import { loadAdminSummary } from '@/lib/budget/admin-summary';
import { AdminSummary } from './admin-summary';

export const metadata = { title: 'Admin Overheads · Budget' };

export default async function AdminOverheadsPage({ searchParams }: PageProps<'/admin-overheads'>) {
  const user = await requireUser();
  // it holds payroll: Finance only
  if (!isFinance(user)) return <div className="p-6 text-slate-600">Admin overheads are entered by Finance.</div>;
  const version = await requireVersion();
  const sp = await searchParams;
  const tab = typeof sp.tab === 'string' && (isItemKind(sp.tab) || sp.tab === 'summary') ? sp.tab : 'overview';
  const summary = tab === 'summary' ? await loadAdminSummary(version) : null;
  const data = summary?.data ?? (await loadAdminOverheads(version));
  const locked = version.status === 'LOCKED';
  const count = (k: string) => data.items.filter((i) => i.kind === k).length;
  return (
    <div className="ui-fill flex min-h-0 flex-col">
      <div className="ui-toolbar ui-toolbar__row">
        <h1 className="ui-toolbar__title">Admin Overheads · {version.name}</h1>
        <RoutedTabs
          ariaLabel="Admin Overheads tabs"
          tabs={[
            { href: '/admin-overheads?tab=summary', label: 'Summary', param: { name: 'tab', value: 'summary' } },
            { href: '/admin-overheads', label: 'Overview', param: { name: 'tab', value: null } },
            ...ITEM_KINDS.map((k) => ({ href: `/admin-overheads?tab=${k.kind}`, label: count(k.kind) > 0 ? `${k.label} (${count(k.kind)})` : k.label, param: { name: 'tab', value: k.kind } })),
          ]}
        />
        <span className="ml-auto text-xs anh-muted">AED</span>
        {tab === 'overview' && <TemplateButtons kind="admin-overheads" versionId={version.id} canImport={!locked} />}
      </div>
      {summary ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <AdminSummary data={summary} />
        </div>
      ) : tab === 'overview' ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <AdminOverheads data={data} versionId={version.id} versionName={version.name} locked={locked} />
        </div>
      ) : (
        <AdminSchedule key={tab} kind={tab as ItemKind} items={data.items.filter((i) => i.kind === tab)} versionId={version.id} year={version.year} locked={locked} />
      )}
    </div>
  );
}
