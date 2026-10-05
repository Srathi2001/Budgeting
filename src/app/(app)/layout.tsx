import { requireUser, getActiveVersion, isFinance } from '@/lib/auth/dal';
import { logout } from '@/app/login/actions';
import { NavLinks } from './nav-links';
import { VersionSwitcher } from './version-switcher';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await requireUser();
  const { version, all } = await getActiveVersion();
  const finance = isFinance(user);
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-4">
          <div className="text-sm font-semibold text-slate-900">Revenue Budget</div>
          <div className="text-xs text-slate-500">MJN · REHL · PMC</div>
        </div>
        <div className="px-3 py-3">
          <VersionSwitcher
            current={version?.id ?? null}
            versions={all.map((v) => ({ id: v.id, name: v.name, status: v.status }))}
          />
        </div>
        <NavLinks finance={finance} />
        <div className="mt-auto border-t border-slate-200 px-4 py-3 text-xs">
          <div className="font-medium text-slate-800">{user.name}</div>
          <div className="text-slate-500">
            {user.role}
            {user.coordinator ? ` · ${user.coordinator}` : ''}
          </div>
          <form action={logout} className="mt-2">
            <button className="text-sky-700 hover:underline">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {version ? children : <div className="p-8 text-slate-600">No budget versions yet. Run the import script first.</div>}
      </main>
    </div>
  );
}
