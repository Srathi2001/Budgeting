import { requireUser, getActiveVersion, visibleProperties, editablePropertyIds } from '@/lib/auth/dal';
import { loadMasterRows } from '@/lib/budget/master';
import { MasterGrid } from './master-grid';

export const metadata = { title: 'Lease Budget · Budget' };

export default async function MasterPage(props: PageProps<'/master'>) {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  const sp = await props.searchParams;
  const props_ = await visibleProperties(user);
  const selected = typeof sp.p === 'string' && sp.p !== 'all' ? Number(sp.p) : null;
  const propertyIds = selected && props_.some((p) => p.id === selected) ? [selected] : props_.map((p) => p.id);
  const editable = await editablePropertyIds(user, version!);
  const rows = await loadMasterRows(version!.id, { propertyIds, editableProperties: editable });

  return (
    <MasterGrid
      key={`${version!.id}-${selected ?? 'all'}`}
      versionId={version!.id}
      year={version!.year}
      locked={version!.status === 'LOCKED'}
      rows={rows}
      properties={props_.map((p) => ({ id: p.id, code: p.code, name: p.name, editable: editable.has(p.id) }))}
      selectedProperty={selected}
    />
  );
}
