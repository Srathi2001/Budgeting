// Chart colour registries (design-system/README.md, Charts). Every segment owns one colour, set as a
// CSS token in globals.css so both themes follow. Map by key, never by position or rank, and keep
// registry order in legends and stacks.
import type { Category } from './budget/category';
import type { ExpiryOutcome } from './budget/dashboard';

/** Measures: the budget figure leads (navy, solid); comparators recede. */
export const MEASURE = {
  budget: 'var(--m-actual)',
  prior: 'var(--m-budget)',
  cash: 'var(--m-committed)',
} as const;

export const CATEGORY_COLOR: Record<Category, string> = {
  Residential: 'var(--seg-residential)',
  Commercial: 'var(--seg-commercial)',
  Retail: 'var(--seg-retail)',
  Warehouse: 'var(--seg-warehouse)',
  Camps: 'var(--seg-camps)',
  Mall: 'var(--seg-mall)',
};

export const OUTCOME_COLOR: Record<ExpiryOutcome, string> = {
  Renew: 'var(--seg-renew)',
  'New tenant': 'var(--seg-new-tenant)',
  'Not re-let': 'var(--seg-not-relet)',
  Contracted: 'var(--seg-contracted)',
};

/** New tenants moving in (a line over the renewal profile) */
export const MOVE_IN_COLOR = 'var(--seg-move-in)';
