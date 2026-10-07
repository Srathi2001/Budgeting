import { cookies } from 'next/headers';
import { requireUser, getActiveVersion, isFinance } from '@/lib/auth/dal';
import { THEME_COOKIE } from '@/lib/theme';
import { logout } from '@/app/login/actions';
import { NavLinks, PageCrumb } from './nav-links';
import { ThemeSwitch } from './theme-switch';
import { VersionSwitcher } from './version-switcher';
import { FilterBar, FiltersProvider } from '@/components/filter-bar';
import { filterUniverse, getFilters } from '@/lib/filters-server';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await requireUser();
  const { version, all } = await getActiveVersion();
  const finance = isFinance(user);
  const theme = (await cookies()).get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  return (
    <div className="anh-shell min-h-screen">
      <aside className="anh-side sticky top-0 h-screen overflow-y-auto">
        <div className="anh-brand">
          <div className="mark">AN</div>
          <div>
            <b>Al Naboodah</b>
            <span>Revenue budget</span>
          </div>
        </div>
        <div className="px-4 pt-4">
          <VersionSwitcher
            current={version?.id ?? null}
            versions={all.map((v) => ({ id: v.id, name: v.name, status: v.status }))}
          />
        </div>
        <NavLinks finance={finance} />
        <div className="mt-auto border-t border-slate-200 px-4 py-3 text-[13px]">
          <div className="font-semibold">{user.name}</div>
          <div className="anh-muted text-xs">
            {user.role}
            {user.coordinator ? ` · ${user.coordinator}` : ''}
          </div>
          <form action={logout} className="mt-2">
            <button className="anh-btn anh-btn--secondary anh-btn--sm">Sign out</button>
          </form>
        </div>
      </aside>
      <header className="anh-top">
        <div className="anh-crumbs">
          <span>MJN · REHL · PMC</span>
          {version && (
            <>
              <span>/</span>
              <span>{version.name}</span>
            </>
          )}
          <span>/</span>
          <PageCrumb />
        </div>
        <span className="flex-1" />
        <ThemeSwitch initial={theme} />
      </header>
      <main className="min-w-0">
        {version ? (
          <FiltersProvider initial={await getFilters()} universe={await filterUniverse(user)}>
            <FilterBar />
            {children}
          </FiltersProvider>
        ) : (
          <div className="p-8 text-slate-600">No budget versions yet. Run the import script first.</div>
        )}
      </main>
    </div>
  );
}
