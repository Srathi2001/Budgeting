import Link from 'next/link';
import { requireUser, getActiveVersion } from '@/lib/auth/dal';
import { filteredScope } from '@/lib/filters-server';
import { loadFmPage } from '@/lib/budget/fm-page';
import { FmTemplate } from './fm-template';
import { FmLabour } from './fm-labour';

export const metadata = { title: 'FM Budget · Budget' };

const TABS = [
  { key: 'template', label: 'FM Budget Template' },
  { key: 'labour', label: 'Labour allocation' },
] as const;

export default async function FmPage({ searchParams }: PageProps<'/fm'>) {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  // the shared page filters (BU, PM, category, property)
  const scope = await filteredScope(user);
  const sp = await searchParams;
  const tab = sp.tab === 'labour' ? 'labour' : 'template';
  const f = tab === 'template' ? Number(sp.f) || null : null;
  const data = await loadFmPage(version!, user, scope.propertyIds, f);
  return (
    <div className="flex h-[calc(100vh-var(--topbar-h))] flex-col">
      <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 px-4 py-2">
        <h1 className="text-base font-bold">FM Budget · {version!.name}</h1>
        <nav className="seg" aria-label="FM Budget tabs">
          {TABS.map((t) => (
            <Link key={t.key} href={t.key === 'template' ? '/fm' : '/fm?tab=labour'} aria-current={tab === t.key ? 'page' : undefined} className={tab === t.key ? 'on' : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
        <span className="ml-auto text-xs">AED</span>
      </div>
      {tab === 'template' ? <FmTemplate key={`${data.version.id}-${data.detail?.id ?? 0}`} data={data} /> : <FmLabour key={data.version.id} data={data} />}
    </div>
  );
}
