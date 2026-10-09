import { requireUser, getActiveVersion, visibleProperties, editablePropertyIds } from '@/lib/auth/dal';
import { loadMasterRows } from '@/lib/budget/master';
import { categoryOf } from '@/lib/budget/category';
import { withDefaults } from '@/lib/engine/assumptions';
import { isFiltered } from '@/lib/filters';
import { filteredScope } from '@/lib/filters-server';
import { AdoptPropertyFilter } from '@/components/filter-bar';
import { MasterGrid } from './master-grid';
import { LeaseSummary } from './lease-summary';
import { LeaseTabs } from './lease-tabs';
import { loadLeaseSummary } from '@/lib/budget/lease-summary';

export const metadata = { title: 'Lease Budget · Budget' };

/** ?p=12 or ?p=12,14,19: a link to particular properties (taken over as the shared Property filter) */
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
  const linked = parseIds(sp.p).filter((id) => allowed.has(id));

  // the shared page filters (BU, PM, category, property); a ?p= link wins until it is adopted
  const scope = await filteredScope(user);
  if (sp.tab === 'summary') {
    const data = await loadLeaseSummary(version!, scope.propertyIds, scope.categories, scope.filters);
    return (
      <div className="flex h-[calc(100vh-var(--topbar-h))] flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
          <h1 className="mr-1 text-base font-semibold text-slate-900">Lease Budget</h1>
          <LeaseTabs tab="summary" />
          <span className="ml-auto text-xs">AED</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <LeaseSummary data={data} />
        </div>
      </div>
    );
  }
  const propertyIds = linked.length ? linked : scope.propertyIds;
  const categories = linked.length ? [] : scope.categories;
  const editable = await editablePropertyIds(user, version!);
  const rows = (await loadMasterRows(version!.id, { propertyIds, editableProperties: editable })).filter(
    (r) => !categories.length || categories.includes(categoryOf(r, r.propertyKind)),
  );
  // "properties in view" for adding a unit and for the exports: all of them when nothing is filtered
  const selected = linked.length ? linked : isFiltered(scope.filters) ? propertyIds : [];

  return (
    <>
      {linked.length > 0 && <AdoptPropertyFilter ids={linked} path="/master" />}
      <MasterGrid
        key={`${version!.id}-${selected.join(',') || 'all'}-${categories.join(',')}`}
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
    </>
  );
}
