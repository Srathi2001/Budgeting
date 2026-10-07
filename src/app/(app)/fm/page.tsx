import { requireUser, getActiveVersion } from '@/lib/auth/dal';
import { filteredScope } from '@/lib/filters-server';
import { loadFmPage } from '@/lib/budget/fm-page';
import { FmBudget } from './fm-budget';

export const metadata = { title: 'FM Budget · Budget' };

export default async function FmPage({ searchParams }: PageProps<'/fm'>) {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  // the shared page filters (BU, PM, category, property)
  const scope = await filteredScope(user);
  const f = Number((await searchParams).f) || null;
  const data = await loadFmPage(version!, user, scope.propertyIds, f);
  return <FmBudget key={`${data.version.id}-${data.detail?.id ?? 0}`} data={data} />;
}
