import { cookies } from 'next/headers';
import { requireUser, getActiveVersion, isFinance } from '@/lib/auth/dal';
import { THEME_COOKIE, themeFromCookie } from '@/lib/theme';
import { logout } from '@/app/login/actions';
import { AppShell } from '@/components/shell/app-shell';
import { FilterBar, FiltersProvider } from '@/components/filter-bar';
import { ExportTables } from '@/components/export-tables';
import { filterUniverse, getFilters } from '@/lib/filters-server';
import { ToastProvider } from '@/components/ui/toast';
import { EmptyState } from '@/components/ui/status';
import { MobileNote } from '@/components/shell/mobile-note';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await requireUser();
  const { version, all } = await getActiveVersion();
  const finance = isFinance(user);
  const fm = user.role === 'FM';
  const theme = themeFromCookie((await cookies()).get(THEME_COOKIE)?.value);
  const universe = version ? await filterUniverse(user) : [];
  return (
    <AppShell
      user={{ name: user.name, role: user.role, coordinator: user.coordinator }}
      viewer={{ finance, fm }}
      versions={all.map((v) => ({ id: v.id, name: v.name, status: v.status }))}
      currentVersion={version?.id ?? null}
      theme={theme}
      properties={universe.map((p) => ({ id: p.id, code: p.code, name: p.name, buName: p.buName }))}
      signOut={logout}
      tools={<ExportTables />}
    >
      <ToastProvider>
        {version ? (
          <FiltersProvider initial={await getFilters()} universe={universe}>
            <MobileNote />
            <FilterBar />
            {children}
          </FiltersProvider>
        ) : (
          <div className="p-8">
            <EmptyState title="No budget version yet">{finance ? 'Create the first version in Admin → Budget versions, or run the import script.' : 'Finance has not opened a budget version yet.'}</EmptyState>
          </div>
        )}
      </ToastProvider>
    </AppShell>
  );
}
