import { requireUser, getActiveVersion, visibleProperties, editablePropertyIds } from '@/lib/auth/dal';
import { loadMasterRows } from '@/lib/budget/master';
import { withDefaults } from '@/lib/engine/assumptions';
import { MasterGrid } from './master-grid';

export const metadata = { title: 'Lease Budget · Budget' };

/** ?p=all, ?p=12 or ?p=12,14,19 */
function parseIds(p: string | string[] | undefined): number[] {
  if (typeof p !== 'string' || p === 'all') return [];
  return p
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

export default async function MasterPage(props: PageProps<'/master'>) {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  const sp = await props.searchParams;
  const visible = await visibleProperties(user);
  const allowed = new Set(visible.map((p) => p.id));
  const selected = parseIds(sp.p).filter((id) => allowed.has(id));
  const propertyIds = selected.length ? selected : visible.map((p) => p.id);
  const editable = await editablePropertyIds(user, version!);
  const rows = await loadMasterRows(version!.id, { propertyIds, editableProperties: editable });

  return (
    <MasterGrid
      key={`${version!.id}-${selected.join(',') || 'all'}`}
      versionId={version!.id}
      year={version!.year}
      locked={version!.status === 'LOCKED'}
      staffDiscount={withDefaults(version!.assumptions).staffDiscount}
      mfPct={withDefaults(version!.assumptions).mfPct}
      rows={rows}
      properties={visible.map((p) => ({ id: p.id, code: p.code, name: p.name, editable: editable.has(p.id) }))}
      selectedProperties={selected}
      isAdmin={user.role === 'ADMIN'}
    />
  );
}
