import { requireUser, getActiveVersion, visibleProperties } from '@/lib/auth/dal';
import { loadDashboardData } from '@/lib/budget/dashboard';
import { Dashboard } from './dashboard';

export default async function DashboardPage() {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  const props = await visibleProperties(user);
  const data = await loadDashboardData(version!, props.map((p) => p.id));
  return <Dashboard data={data} locked={version!.status === 'LOCKED'} />;
}
