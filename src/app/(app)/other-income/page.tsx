import { requireUser, getActiveVersion, visibleProperties, editablePropertyIds } from '@/lib/auth/dal';
import { loadOtherIncome } from '@/lib/budget/other-income';
import { withDefaults } from '@/lib/engine/assumptions';
import { OtherIncome } from './other-income';

export const metadata = { title: 'Other Income · Budget' };

export default async function OtherIncomePage() {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  const props = await visibleProperties(user);
  const editable = await editablePropertyIds(user, version!);
  const blocks = await loadOtherIncome(version!, user, props, editable);
  return (
    <OtherIncome
      blocks={blocks}
      versionId={version!.id}
      versionName={version!.name}
      year={version!.year}
      locked={version!.status === 'LOCKED'}
      mfPct={withDefaults(version!.assumptions).mfPct}
    />
  );
}
