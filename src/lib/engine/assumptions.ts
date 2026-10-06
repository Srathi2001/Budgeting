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
}

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
};

export function withDefaults(partial: Partial<Assumptions> | null | undefined): Assumptions {
  const out = { ...DEFAULT_ASSUMPTIONS };
  // ignore keys from older versions (e.g. removed fee settings)
  for (const k of Object.keys(DEFAULT_ASSUMPTIONS) as (keyof Assumptions)[]) {
    if (partial && partial[k] !== undefined) (out as Record<string, unknown>)[k] = partial[k];
  }
  return out;
}
