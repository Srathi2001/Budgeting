import { redirect } from 'next/navigation';
import { requireUser, visibleProperties, requireVersion } from '@/lib/auth/dal';
import { loadDashboardData } from '@/lib/budget/dashboard';
import { loadDashboardReports } from '@/lib/budget/dashboard-reports';
import { filteredScope, getFilters } from '@/lib/filters-server';
import { Dashboard } from './dashboard';

export const metadata = { title: 'Dashboard · Budget' };

export default async function DashboardPage() {
  const user = await requireUser();
  if (user.role === 'FM') redirect('/fm');
  const version = await requireVersion();
  const props = await visibleProperties(user);
  const data = await loadDashboardData(version, props.map((p) => p.id), await getFilters());
  const reports = await loadDashboardReports(version, user, await filteredScope(user));
  return <Dashboard data={data} reports={reports} locked={version.status === 'LOCKED'} />;
}
