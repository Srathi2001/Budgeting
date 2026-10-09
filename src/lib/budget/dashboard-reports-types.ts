// Dashboard report cards (rent by year, other income actuals, operating costs, building capex):
// types and fixed orders shared by the server loader and the page.
import type { WorkType } from './fm-types';

/** other income types, by the account's side in the 2026 OtherxIncome split */
import type { OiType } from './other-income-types';
export { OI_TYPES, type OiType } from './other-income-types';

/** building elements grouped for the capex view */
export const CAPEX_GROUPS = ['AC / HVAC', 'Fire, security & FFE', 'Civil & structure', 'Finishes & refurbishment', 'MEP & services', 'Other'] as const;
export type CapexGroup = (typeof CAPEX_GROUPS)[number];

export interface DashboardReports {
  labels: { B: string; P: string; F: string; A1: string; A2: string; fmYtd: string; oiYtd: string };
  /** Oracle rent actuals from FIRST_REPORT_YEAR, the prior budget, the forecast and the budget, by business unit */
  rentByYear: {
    bus: { code: string; name: string }[];
    years: {
      label: string;
      source: string;
      byBu: Record<string, number | null>;
      properties: number;
      /** like for like (properties with a figure in both years) on `base` */
      base: string | null;
      growth: number | null;
    }[];
  };
  /** GL actuals as uploaded (Account Analysis Report): two full years and the current year to date */
  otherIncome: {
    general: boolean;
    accounts: { code: string; name: string; type: OiType; a2: number; a1: number; ytd: number }[];
    outside: { a2: number; a1: number; ytd: number };
  };
  costs: {
    budgeted: boolean;
    priorBudgeted: boolean;
    /** section: operating cost, below gross profit, or cash flow only */
    lines: { key: string; label: string; section: 'opex' | 'belowGp' | 'cashOnly'; prior: number | null; budget: number | null }[];
    /** prior / budget null: that version's FM budget is not entered */
    workTypes: { code: WorkType; label: string; line: 'maintenance' | 'capex'; a2: number; a1: number; ytd: number; prior: number | null; budget: number | null }[];
    staff: { team: string; label: string; prior: number | null; budget: number | null }[];
  };
  capex: {
    groups: { group: CapexGroup; a1: number; ytd: number; prior: number; budget: number }[];
    kinds: { kind: string; label: string; prior: number; budget: number }[];
    buildings: { name: string; prior: number; budget: number }[];
  };
}
