// Budget-version level assumptions. Defaults mirror the 2026 PM templates
// (Budget <PM> <BU> X.xlsx: Main / Revenue / Cash / Admin / MF / AF / EF sheets).

export interface ReraBand {
  /** Increase applies when the rent is more than `gapAbove` below the RERA average (fraction, e.g. 0.11). */
  gapAbove: number;
  increase: number;
}

export interface Assumptions {
  /** Gap between end of a non-renewed lease and the new tenant's start (Main!U: Q+60). */
  vacancyGapDays: number;
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
  /** Default number of cheques per contract (Cash sheet: rent/4). */
  defaultCheques: number;
  /** Total days the cheque schedule spans; interval = span / cheques (Cash sheet: 370/4). */
  chequeSpanDays: number;
  adminFeeResidential: number;
  adminFeeCommercial: number;
  ejariFee: number;
  /** MF (Y/N) contracts: fee as a % of annual rent, booked in the start month. */
  mfPct: number;
  /** Agency commission on new-tenant leases, % of annual rent. */
  agencyPct: number;
  /** VAT on commercial / labour rent and on all fees (residential rent is exempt). Included in cash inflow. */
  vatRate: number;
  /** Security deposit taken from a new tenant, % of annual rent (Fusion leases: median 5%). */
  depositPct: number;
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  vacancyGapDays: 60,
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
  adminFeeResidential: 500,
  adminFeeCommercial: 1000,
  ejariFee: 200,
  mfPct: 0.05,
  agencyPct: 0.025,
  vatRate: 0.05,
  depositPct: 0.05,
};

export function withDefaults(partial: Partial<Assumptions> | null | undefined): Assumptions {
  return { ...DEFAULT_ASSUMPTIONS, ...(partial ?? {}) };
}
