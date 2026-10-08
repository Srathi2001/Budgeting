import Link from 'next/link';
import { requireUser, getActiveVersion, isFinance } from '@/lib/auth/dal';
import { loadAdminOverheads } from '@/lib/budget/admin';
import { ITEM_KINDS, isItemKind } from '@/lib/budget/admin-items';
import { AdminOverheads } from './admin-overheads';
import { AdminSchedule } from './admin-schedule';

export const metadata = { title: 'Admin Overheads · Budget' };

export default async function AdminOverheadsPage({ searchParams }: PageProps<'/admin-overheads'>) {
  const user = await requireUser();
  // it holds payroll: Finance only
  if (!isFinance(user)) return <div className="p-6 text-slate-600">Admin overheads are entered by Finance.</div>;
  const { version } = await getActiveVersion();
  const sp = await searchParams;
  const tab = typeof sp.tab === 'string' && isItemKind(sp.tab) ? sp.tab : 'overview';
  const data = await loadAdminOverheads(version!);
  const locked = version!.status === 'LOCKED';
  const count = (k: string) => data.items.filter((i) => i.kind === k).length;
  return (
    <div className="flex h-[calc(100vh-var(--topbar-h))] flex-col">
      <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 px-4 py-2">
        <h1 className="text-base font-bold">Admin Overheads · {version!.name}</h1>
        <nav className="seg" aria-label="Admin Overheads tabs">
          <Link href="/admin-overheads" aria-current={tab === 'overview' ? 'page' : undefined} className={tab === 'overview' ? 'on' : undefined}>
            Overview
          </Link>
          {ITEM_KINDS.map((k) => (
            <Link key={k.kind} href={`/admin-overheads?tab=${k.kind}`} aria-current={tab === k.kind ? 'page' : undefined} className={tab === k.kind ? 'on' : undefined}>
              {k.label}
              {count(k.kind) > 0 && <span className="ml-1 tabular-nums">({count(k.kind)})</span>}
            </Link>
          ))}
        </nav>
        <span className="ml-auto text-xs">AED</span>
      </div>
      {tab === 'overview' ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <AdminOverheads data={data} versionId={version!.id} versionName={version!.name} locked={locked} />
        </div>
      ) : (
        <AdminSchedule key={tab} kind={tab} items={data.items.filter((i) => i.kind === tab)} versionId={version!.id} year={version!.year} locked={locked} />
      )}
    </div>
  );
}
