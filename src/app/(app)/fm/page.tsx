import Link from 'next/link';
import { requireUser, getActiveVersion } from '@/lib/auth/dal';
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
  const { version } = await getActiveVersion();
  // the shared page filters (BU, PM, category, property)
  const scope = await filteredScope(user);
  const sp = await searchParams;
  const tab = sp.tab === 'labour' || sp.tab === 'summary' ? sp.tab : 'template';
  const f = tab === 'template' ? Number(sp.f) || null : null;
  if (tab === 'summary') {
    const summary = await loadFmSummary(version!, user, scope.propertyIds);
    return (
      <div className="flex h-[calc(100vh-var(--topbar-h))] flex-col">
        {head(tab)}
        <div className="min-h-0 flex-1 overflow-auto">
          <FmSummary data={summary} />
        </div>
      </div>
    );
  }
  const data = await loadFmPage(version!, user, scope.propertyIds, f);
  return (
    <div className="flex h-[calc(100vh-var(--topbar-h))] flex-col">
      {head(tab)}
      {tab === 'template' ? <FmTemplate key={`${data.version.id}-${data.detail?.id ?? 0}`} data={data} /> : <FmLabour key={data.version.id} data={data} />}
    </div>
  );

  function head(tab: string) {
    return (
      <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 px-4 py-2">
        <h1 className="text-base font-bold">FM Budget · {version!.name}</h1>
        <nav className="seg" aria-label="FM Budget tabs">
          {TABS.map((t) => (
            <Link key={t.key} href={t.key === 'template' ? '/fm' : `/fm?tab=${t.key}`} aria-current={tab === t.key ? 'page' : undefined} className={tab === t.key ? 'on' : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
        <span className="ml-auto text-xs">AED</span>
      </div>
    );
  }
}
