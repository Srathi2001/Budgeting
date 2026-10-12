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
  const [props, filters, scope] = await Promise.all([visibleProperties(user), getFilters(), filteredScope(user)]);
  // the two halves of the page don't depend on each other: worked out at the same time
  const [data, reports] = await Promise.all([loadDashboardData(version, props.map((p) => p.id), filters), loadDashboardReports(version, user, scope)]);
  return <Dashboard data={data} reports={reports} locked={version.status === 'LOCKED'} />;
}
