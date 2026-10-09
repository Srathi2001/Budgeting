import { RoutedTabs } from '@/components/ui/tabs';
import { requireUser, requireVersion } from '@/lib/auth/dal';
import { filteredScope } from '@/lib/filters-server';
import { loadFmPage } from '@/lib/budget/fm-page';
import { FmTemplate } from './fm-template';
import { FmLabour } from './fm-labour';
import { FmSummary } from './fm-summary';
import { loadFmSummary } from '@/lib/budget/fm-summary';

export const metadata = { title: 'FM Budget · Budget' };

const TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'template', label: 'FM Budget Template' },
  { key: 'labour', label: 'Labour allocation' },
] as const;

export default async function FmPage({ searchParams }: PageProps<'/fm'>) {
  const user = await requireUser();
  const version = await requireVersion();
  // the shared page filters (BU, PM, category, property)
  const scope = await filteredScope(user);
  const sp = await searchParams;
  const tab = sp.tab === 'labour' || sp.tab === 'summary' ? sp.tab : 'template';
  const f = tab === 'template' ? Number(sp.f) || null : null;
  if (tab === 'summary') {
    const summary = await loadFmSummary(version, user, scope.propertyIds);
    return (
      <div className="ui-fill flex min-h-0 flex-col">
        {head()}
        <div className="min-h-0 flex-1 overflow-auto">
          <FmSummary data={summary} />
        </div>
      </div>
    );
  }
  const data = await loadFmPage(version, user, scope.propertyIds, f);
  return (
    <div className="ui-fill flex min-h-0 flex-col">
      {head()}
      {tab === 'template' ? <FmTemplate key={`${data.version.id}-${data.detail?.id ?? 0}`} data={data} /> : <FmLabour key={data.version.id} data={data} />}
    </div>
  );

  // the current tab comes from the address (RoutedTabs reads ?tab=)
  function head() {
    return (
      <div className="ui-toolbar ui-toolbar__row">
        <h1 className="ui-toolbar__title">FM Budget · {version.name}</h1>
        <RoutedTabs ariaLabel="FM Budget tabs" tabs={TABS.map((t) => ({ href: t.key === 'template' ? '/fm' : `/fm?tab=${t.key}`, label: t.label, param: { name: 'tab', value: t.key === 'template' ? null : t.key } }))} />
        <span className="ml-auto text-xs anh-muted">AED</span>
      </div>
    );
  }
}
