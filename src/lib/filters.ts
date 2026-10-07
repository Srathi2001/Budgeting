// Page filters shared by every report and input tab (Dashboard, Building P&L, Monthly Summary,
// Revenue Analysis, Lease Budget, Other Income, Submissions). One selection, kept in a cookie so it
// follows the user from tab to tab and server-rendered pages can apply it too. Empty list = all.
import { CATEGORIES, type Category } from './budget/category';

export const FILTER_COOKIE = 'flt';

export interface Filters {
  /** business unit codes (501, 502, …) */
  bu: string[];
  /** property managers (coordinator codes) */
  pm: string[];
  /** reporting categories of units */
  cat: Category[];
  /** property ids */
  prop: string[];
}

export const NO_FILTERS: Filters = { bu: [], pm: [], cat: [], prop: [] };

/** A property as the filter bar sees it: what it can be filtered by. */
export interface FilterProperty {
  id: number;
  code: string;
  name: string;
  bu: string;
  buName: string;
  pm: string;
  /** categories of its units in the active version */
  categories: Category[];
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 500) : []);

export function parseFilters(raw: string | undefined | null): Filters {
  if (!raw) return NO_FILTERS;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      bu: strings(o.bu),
      pm: strings(o.pm),
      cat: strings(o.cat).filter((c): c is Category => (CATEGORIES as readonly string[]).includes(c)),
      prop: strings(o.prop),
    };
  } catch {
    return NO_FILTERS;
  }
}

export const serializeFilters = (f: Filters) => JSON.stringify(f);

export const isFiltered = (f: Filters) => f.bu.length + f.pm.length + f.cat.length + f.prop.length > 0;

const pass = (sel: string[], v: string) => sel.length === 0 || sel.includes(v);

/** Does a property pass the filters? With a category filter, it needs at least one unit in it. */
export function propertyPasses(p: FilterProperty, f: Filters): boolean {
  return pass(f.bu, p.bu) && pass(f.pm, p.pm) && pass(f.prop, String(p.id)) && (f.cat.length === 0 || p.categories.some((c) => f.cat.includes(c)));
}

/** Does a unit pass? (its property's BU / PM / id, and its own category) */
export function unitPasses(u: { bu: string; pm: string; propertyId: number; category: Category }, f: Filters): boolean {
  return pass(f.bu, u.bu) && pass(f.pm, u.pm) && pass(f.prop, String(u.propertyId)) && pass(f.cat, u.category);
}
