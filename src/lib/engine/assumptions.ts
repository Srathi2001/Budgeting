// Budget-version level assumptions. Defaults mirror the 2026 PM templates
// (Budget <PM> <BU> X.xlsx: Main / Revenue / Cash sheets) and Fusion lease data.

export interface ReraBand {
  /** Increase applies when the rent is more than `gapAbove` below the RERA average (fraction, e.g. 0.11). */
  gapAbove: number;
  increase: number;
}

export interface Assumptions {
  // (the vacancy gap before a new tenant is entered per lease: LeaseInput.vacancyDays)
  /** Renewal contract length in days (Main!V: U+365-1). */
  renewalTermDays: number;
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
  /** VAT on commercial / labour rent (residential rent is exempt). Included in cash inflow. */
  vatRate: number;
  /** Security deposit taken from a new tenant, % of annual rent (Fusion leases: median 5%). */
  depositPct: number;
  /** Maintenance service fee on residential leases with MF, % of the contract rent (other income). */
  mfPct: number;
  /**
   * Last closed month of the GL actuals (1–12) the budget is built on: other income YTD = Jan to this
   * month of Y-1, the rest of Y-1 is the typed forecast. The 2026 budget was built on September (9).
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
}

/** set in Building overheads' Assumptions tab, not in Admin */
export const BOH_ASSUMPTION_KEYS = ['bohUtilitiesPct', 'insParPct', 'insPlPct', 'watchmanCost'] as const;
export type BohAssumptionKey = (typeof BOH_ASSUMPTION_KEYS)[number];
/** the assumptions set in Admin (the fee rates are set per landlord in Admin overheads) */
export type AdminAssumptions = Omit<Assumptions, BohAssumptionKey | 'pmaRate' | 'amaRate'>;

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  renewalTermDays: 365,
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
};

export function withDefaults(partial: Partial<Assumptions> | null | undefined): Assumptions {
  const out = { ...DEFAULT_ASSUMPTIONS };
  // ignore keys from older versions (e.g. removed fee settings)
  for (const k of Object.keys(DEFAULT_ASSUMPTIONS) as (keyof Assumptions)[]) {
    if (partial && partial[k] !== undefined) (out as Record<string, unknown>)[k] = partial[k];
  }
  return out;
}
