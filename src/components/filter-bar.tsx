'use client';

// The shared page filters (Business unit, Property manager, Category, Property): one selection for
// every tab, kept in a cookie. Pages read it with useFilters(); pages filtered on the server are
// refreshed when it changes.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CATEGORIES, type Category } from '@/lib/budget/category';
import { FILTER_COOKIE, NO_FILTERS, isFiltered, propertyPasses, serializeFilters, type FilterProperty, type Filters } from '@/lib/filters';
import { MultiSelect } from './multi-select';

interface Ctx {
  filters: Filters;
  setFilters: (f: Filters) => void;
  universe: FilterProperty[];
}

const FiltersContext = createContext<Ctx>({ filters: NO_FILTERS, setFilters: () => {}, universe: [] });

/** Tabs that show the filter bar; those marked true are filtered on the server and refresh on a change. */
const FILTERED_TABS: Record<string, boolean> = {
  // the dashboard filters its charts in the browser, but the rent per sq ft card comes from the server
  '/': true,
  '/pnl': true,
  '/summary': true,
  '/analysis': false,
  '/master': true,
  '/other-income': false,
  '/submissions': true,
  '/fm': true,
};

export function FiltersProvider({ initial, universe, children }: { initial: Filters; universe: FilterProperty[]; children: ReactNode }) {
  const [filters, setState] = useState(initial);
  const router = useRouter();
  const path = usePathname();
  const setFilters = useCallback(
    (f: Filters) => {
      setState(f);
      document.cookie = `${FILTER_COOKIE}=${encodeURIComponent(serializeFilters(f))}; path=/; max-age=31536000; samesite=lax`;
      if (FILTERED_TABS[path]) router.refresh();
    },
    [router, path],
  );
  const value = useMemo(() => ({ filters, setFilters, universe }), [filters, setFilters, universe]);
  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export const useFilters = () => useContext(FiltersContext);

/**
 * A link to one property (e.g. /master?p=12 from a report) becomes the shared Property filter, so
 * the choice carries on to the other tabs; the address is then cleaned up.
 */
export function AdoptPropertyFilter({ ids, path }: { ids: number[]; path: string }) {
  const { setFilters } = useFilters();
  const router = useRouter();
  useEffect(() => {
    setFilters({ ...NO_FILTERS, prop: ids.map(String) });
    router.replace(path);
    // once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** The filter row under the top bar, on the tabs that use it. */
export function FilterBar() {
  const path = usePathname();
  const { filters: f, setFilters, universe } = useFilters();
  if (!(path in FILTERED_TABS)) return null;

  const bus = [...new Map(universe.map((p) => [p.bu, p.buName])).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const pms = [...new Set(universe.map((p) => p.pm))].sort();
  const count = (key: (p: FilterProperty) => string | string[]) => {
    const m = new Map<string, number>();
    for (const p of universe) for (const k of ([] as string[]).concat(key(p))) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };
  const buN = count((p) => p.bu);
  const pmN = count((p) => p.pm);
  const catN = count((p) => p.categories);
  // the property list follows the other filters
  const propOptions = universe
    .filter((p) => propertyPasses(p, { ...f, prop: [] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const inView = universe.filter((p) => propertyPasses(p, f)).length;
  const set = (patch: Partial<Filters>) => setFilters({ ...f, ...patch });

  return (
    <div className="anh-filterbar px-6 pt-4 text-[13px]">
      <MultiSelect
        label="Business unit"
        value={f.bu}
        onChange={(v) => set({ bu: v, prop: [] })}
        options={bus.map(([code, name]) => ({ value: code, label: `${code} ${name}`, count: buN.get(code) }))}
      />
      <MultiSelect
        label="Property manager"
        value={f.pm}
        onChange={(v) => set({ pm: v, prop: [] })}
        options={pms.map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase(), count: pmN.get(p) }))}
      />
      <MultiSelect
        label="Category"
        value={f.cat}
        onChange={(v) => set({ cat: v as Category[] })}
        options={CATEGORIES.map((c) => ({ value: c, label: c, count: catN.get(c) ?? 0 }))}
      />
      <MultiSelect
        label="Property"
        width="w-72"
        value={f.prop}
        onChange={(v) => set({ prop: v })}
        options={propOptions.map((p) => ({ value: String(p.id), label: `${p.name} · ${p.code}` }))}
      />
      {/* always there, beside the filters; nothing to reset = disabled */}
      <button
        type="button"
        className="btn btn-xs"
        disabled={!isFiltered(f)}
        title={isFiltered(f) ? 'Back to all business units, managers, categories and properties' : 'No filters set'}
        onClick={() => setFilters(NO_FILTERS)}
      >
        Reset filters
      </button>
      <span className="ml-auto text-xs text-slate-500">
        {inView} of {universe.length} properties
      </span>
    </div>
  );
}
