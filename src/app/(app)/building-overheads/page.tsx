import { redirect } from 'next/navigation';
import { requireUser, getActiveVersion, visibleProperties, editablePropertyIds, isFinance } from '@/lib/auth/dal';
import { loadBuildingOverheads } from '@/lib/budget/boh';
import { BuildingOverheads } from './building-overheads';

export const metadata = { title: 'Building Overheads · Budget' };

export default async function BuildingOverheadsPage() {
  const user = await requireUser();
  if (user.role === 'FM') redirect('/fm');
  const { version } = await getActiveVersion();
  const props = await visibleProperties(user);
  const editable = await editablePropertyIds(user, version!);
  const { blocks, cutoff } = await loadBuildingOverheads(version!, props, editable);
  return (
    <BuildingOverheads
      blocks={blocks}
      versionId={version!.id}
      versionName={version!.name}
      year={version!.year}
      cutoff={cutoff}
      locked={version!.status === 'LOCKED'}
      finance={isFinance(user)}
    />
  );
}
