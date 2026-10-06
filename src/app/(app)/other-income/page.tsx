import { requireUser, getActiveVersion, visibleProperties } from '@/lib/auth/dal';
import { loadOtherIncome } from '@/lib/budget/other-income';
import { OtherIncome } from './other-income';

export const metadata = { title: 'Other Income · Budget' };

export default async function OtherIncomePage() {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  const props = await visibleProperties(user);
  const rows = await loadOtherIncome(version!.id, props.map((p) => p.id));
  return <OtherIncome rows={rows} versionName={version!.name} year={version!.year} />;
}
