// Budget-version level assumptions. Defaults mirror the 2026 PM templates
// (Budget <PM> <BU> X.xlsx: Main / Revenue / Cash sheets) and Fusion lease data.

export interface ReraBand {
  /** Increase applies when the rent is more than `gapAbove` below the RERA average (fraction, e.g. 0.11). */
  gapAbove: number;
  increase: number;
}

export interface Assumptions {
  /** Renewal contract length (Main!V: U+365-1): whole years (365, 730 …) run in calendar years, leap days included (engine/dates termEnd) */
  renewalTermDays: number;
  /** empty days before a new tenant when none are entered for the lease (user decision 11-Oct-2026: 60) */
  defaultVacancyDays: number;
  /** Discount applied to staff rents when comparing with the RERA index (Main!AJ). */
  staffDiscount: number;
  /** RERA increase bands, evaluated from the highest gap down (Main!AE). */
  reraBands: ReraBand[];
  /** Flat renewal increase for labour (R/C = 'L') units outside the camps (Main!AE). */
  labourIncrease: number;
  /** Default renewal increase for labour camps (Camps New: renewal = rent x 1.2). */
  campIncrease: number;
  /** Default number of cheques per renewal contract (Cash sheet: rent/4). */
  defaultCheques: number;
  /** Total days the cheque schedule spans; interval = span / cheques (Cash sheet: 370/4). */
  chequeSpanDays: number;
  /** VAT on commercial / labour rent (residential rent is exempt). For reference: not cash inflow (passes through to the FTA). */
  vatRate: number;
  /** Security deposit taken from a new tenant, % of annual rent (Fusion leases: median 5%). */
  depositPct: number;
  /** Maintenance service fee on residential leases with MF, % of the contract rent (other income). */
  mfPct: number;
  /**
   * Last month of actuals of Y-1 (1–12) the budget is built on. Rent: the Y-1 forecast is Oracle actuals
   * to this month, then the leases and the PMs' inputs (forecast.ts). Other income: YTD = Jan to this
   * month of Y-1 from the GL, the rest of Y-1 is typed. The 2026 and 2027 budgets: September (9).
   */
  actualsCutoffMonth: number;
  /**
   * ANPM's property management fee (PMA), % of each landlord's rent, and MJNH's asset management fee (AMA),
   * % of its asset value: the rates when there is no last budget to default to. Set per landlord in Admin
   * overheads (2026 budget: 6% and 0.5%).
   */
  pmaRate: number;
  amaRate: number;
  // Building overheads (set in its Assumptions tab)
  /** water & electricity: forecast and budget increase on the year before (2026 budget: 5%) */
  bohUtilitiesPct: number;
  /** insurance: change of the PAR rate on last year's (2026 budget: 7%) */
  insParPct: number;
  /** insurance: change of the public liability premium on last year's (2026 budget: 7%) */
  insPlPct: number;
  /** cost per watchman a year (2026 budget: 49,335) */
  watchmanCost: number;
  // Yearly rules, set per version in Admin → Assumptions (audit FIN-019; defaults: the 2026 budget)
  /**
   * G&A payroll rules by department (PayrollxCost F:I): share capitalised to projects (PDD) and to ASRE
   * of payroll + ANPM overheads, to MJNH of payroll; ASRE on the senior staff, or the whole department.
   */
  payrollRules: Record<string, PayrollRule>;
  /** FM supervisory staff: its split over work types and the business units it is spread over (Labor_Allocation) */
  fmSupervision: FmSupervision;
}

export interface PayrollRule {
  cap: number;
  mjnh: number;
  asre: number;
  asreWhole?: boolean;
}
export interface FmSupervision {
  split: { share: number; workTypes: string[] }[];
  bus: string[];
}

/** 2026 rules (PayrollxCost F:I and note B33); other departments: nothing capitalised or recharged, ASRE 5% */
export const DEFAULT_PAYROLL_RULES: Record<string, PayrollRule> = {
  '212': { cap: 1, mjnh: 0, asre: 0.05 },
  '201': { cap: 0.1, mjnh: 0, asre: 0.05 },
  '207': { cap: 0.05, mjnh: 0.21, asre: 0.05 },
  '206': { cap: 0.1, mjnh: 0, asre: 0.05 },
  '000': { cap: 0.05, mjnh: 0, asre: 0.05 },
  '214': { cap: 0, mjnh: 0, asre: 0.05, asreWhole: true },
};
export const OTHER_DEPT_RULE: PayrollRule = { cap: 0, mjnh: 0, asre: 0.05 };

/** 2026 Labor_Allocation: M1 19%, M2–M4 30%, R1/R2/R4 42%, R3 9%; over 501 and 502 (PMC none) */
export const DEFAULT_FM_SUPERVISION: FmSupervision = {
  split: [
    { share: 0.19, workTypes: ['M01'] },
    { share: 0.3, workTypes: ['M02', 'M03', 'M04'] },
    { share: 0.42, workTypes: ['R01', 'R02', 'R04'] },
    { share: 0.09, workTypes: ['R03'] },
  ],
  bus: ['501', '502'],
};

/** set in Building overheads' Assumptions tab, not in Admin */
export const BOH_ASSUMPTION_KEYS = ['bohUtilitiesPct', 'insParPct', 'insPlPct', 'watchmanCost'] as const;
export type BohAssumptionKey = (typeof BOH_ASSUMPTION_KEYS)[number];
/** the assumptions set in Admin (the fee rates are set per landlord in Admin overheads) */
export type AdminAssumptions = Omit<Assumptions, BohAssumptionKey | 'pmaRate' | 'amaRate' | YearlyRuleKey>;
/** set in Admin → Assumptions' yearly rules (their own save) */
export type YearlyRuleKey = 'payrollRules' | 'fmSupervision';

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  renewalTermDays: 365,
  defaultVacancyDays: 60,
  staffDiscount: 0.2,
  reraBands: [
    { gapAbove: 0.41, increase: 0.2 },
    { gapAbove: 0.31, increase: 0.15 },
    { gapAbove: 0.21, increase: 0.1 },
    { gapAbove: 0.11, increase: 0.05 },
  ],
  labourIncrease: 0.1,
  campIncrease: 0.2,
  defaultCheques: 4,
  chequeSpanDays: 370,
  vatRate: 0.05,
  depositPct: 0.05,
  mfPct: 0.05,
  actualsCutoffMonth: 9,
  pmaRate: 0.06,
  amaRate: 0.005,
  bohUtilitiesPct: 0.05,
  insParPct: 0.07,
  insPlPct: 0.07,
  watchmanCost: 49335,
  payrollRules: DEFAULT_PAYROLL_RULES,
  fmSupervision: DEFAULT_FM_SUPERVISION,
};

export function withDefaults(partial: Partial<Assumptions> | null | undefined): Assumptions {
  const out = { ...DEFAULT_ASSUMPTIONS };
  // ignore keys from older versions (e.g. removed fee settings)
  for (const k of Object.keys(DEFAULT_ASSUMPTIONS) as (keyof Assumptions)[]) {
    if (partial && partial[k] !== undefined) (out as Record<string, unknown>)[k] = partial[k];
  }
  return out;
}
