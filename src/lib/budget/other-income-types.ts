// Other income: GL accounts and periods (shared by the server and the Other Income page).
// Accounts and the Landlord / ANPM split follow the 2026 budget template (OtherxIncome sheet), plus
// 52311 from the MJN PRIVATE OFFICE ledger.

export type OiSide = 'LL' | 'ANPM';

export interface OiAccount {
  code: string;
  name: string;
  side: OiSide | null;
  /** company-level: budgeted on the BU's General row, not per property */
  general?: boolean;
  /** budget calculated from the leases, not entered */
  calc?: 'MF';
}

export const OI_ACCOUNTS: OiAccount[] = [
  { code: '52101', name: 'Profit / loss on sale of assets', side: 'LL', general: true },
  { code: '52201', name: 'Interest on bank deposits', side: 'LL', general: true },
  { code: '52302', name: 'Unclaimed payments written back', side: 'LL', general: true },
  { code: '52311', name: 'Rental income from joint ownership land', side: null, general: true },
  { code: '52401', name: 'Administration fee - own properties', side: 'ANPM' },
  { code: '52402', name: 'Administration fee - managed properties', side: 'ANPM' },
  { code: '52501', name: 'Cheque return fee - own properties', side: 'ANPM' },
  { code: '52502', name: 'Cheque return fee - managed properties', side: 'ANPM' },
  { code: '52601', name: 'Agency commission - own properties', side: 'ANPM' },
  { code: '52602', name: 'Agency commission - managed properties', side: 'ANPM' },
  { code: '52603', name: 'Agency commission - others', side: 'ANPM' },
  { code: '52701', name: 'Related property maintenance', side: 'ANPM' },
  { code: '52702', name: 'Maintenance service fee', side: 'LL', calc: 'MF' },
  { code: '52703', name: 'Ejari fee', side: 'ANPM' },
  { code: '52704', name: 'Parking charges', side: 'LL' },
  { code: '52705', name: 'Short term lease excess charges', side: 'LL' },
  { code: '52706', name: 'Break lease charges', side: 'LL' },
  { code: '52707', name: 'Name change charges', side: 'ANPM' },
  { code: '52709', name: 'NOC charges', side: 'ANPM' },
  { code: '52712', name: 'Utility charges - recovered', side: 'LL' },
  { code: '52713', name: 'Legal charges - recovered', side: 'LL' },
  { code: '52714', name: 'Direct maintenance charges - recovered', side: 'LL' },
  { code: '52801', name: 'Management fee income', side: 'LL', general: true },
  { code: '52905', name: 'Miscellaneous income', side: null },
  { code: '52907', name: 'Handyman services income', side: 'LL' },
  { code: '52908', name: 'Tenant chargeables', side: 'LL' },
];
export const OI_ACCOUNT = new Map(OI_ACCOUNTS.map((a) => [a.code, a]));

/** reporting type of an account: landlord charges, ANPM's fees, the PMA fee, interest & company income */
export const OI_TYPES = ['Landlord charges', 'ANPM fees', 'Management fee (PMA)', 'Interest & company income'] as const;
export type OiType = (typeof OI_TYPES)[number];
export function oiType(account: string): OiType {
  const a = OI_ACCOUNT.get(account);
  if (account === '52801') return 'Management fee (PMA)';
  if (a?.side === 'ANPM') return 'ANPM fees';
  if (a?.general || !a?.side) return 'Interest & company income';
  return 'Landlord charges';
}

/**
 * Stored periods, relative to the version year Y: A2 = Y-3 actual, A1 = Y-2 actual, YTD = Y-1 Jan to the
 * GL cut-off month (actual, from the GL; September for the 2026 budget), OD = the rest of Y-1 (input),
 * B = budget Y (input). F = YTD + OD is calculated. The cut-off is the version's actualsCutoffMonth.
 */
export const OI_STORED = ['A2', 'A1', 'YTD', 'OD', 'B'] as const;
export type OiPeriod = (typeof OI_STORED)[number];
export const OI_INPUT: readonly OiPeriod[] = ['OD', 'B'];
export type OiColumn = OiPeriod | 'F';
export const OI_COLUMNS: OiColumn[] = ['A2', 'A1', 'YTD', 'OD', 'F', 'B'];

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Column label; `cutoff` is the version's GL actuals cut-off month (1–12, default September). */
export function oiLabel(c: OiColumn, year: number, cutoff = 9): string {
  const m = Math.min(12, Math.max(1, Math.round(cutoff)));
  const ytd = m === 1 ? `${year - 1} Jan` : `${year - 1} Jan–${MON[m - 1]}`;
  const od = m >= 12 ? `${year - 1} (none)` : m === 11 ? `${year - 1} Dec` : `${year - 1} ${MON[m]}–Dec`;
  return { A2: `${year - 3}A`, A1: `${year - 2}A`, YTD: ytd, OD: od, F: `${year - 1}F`, B: `${year}B` }[c];
}

/** account → period → amount (null: nothing entered) */
export type OiValues = Record<string, Partial<Record<OiPeriod, number | null>>>;

export interface OiBlock {
  /** 'P:<property id>' or 'G:<bu code>' */
  scope: string;
  kind: 'P' | 'G';
  propertyId: number | null;
  buCode: string;
  buName: string;
  code: string;
  name: string;
  pm: string | null;
  editable: boolean;
  values: OiValues;
  /** maintenance service fee from the leases, budget year */
  mfBudget: number;
  /** other budget amounts calculated, not entered (ANPM's PMA fee: the rate × the landlords' rent), by account */
  calcB?: Record<string, number>;
}

export interface OiChange {
  scope: string;
  account: string;
  period: OiPeriod;
  amount: number | null;
}

/** The value of one cell, with F and the calculated MF budget filled in. */
export function oiCell(b: OiBlock, account: string, c: OiColumn): number | null {
  const v = b.values[account] ?? {};
  if (c === 'F') return v.YTD == null && v.OD == null ? null : (v.YTD ?? 0) + (v.OD ?? 0);
  if (c === 'B' && OI_ACCOUNT.get(account)?.calc === 'MF') return b.kind === 'P' ? b.mfBudget || null : null;
  if (c === 'B' && b.calcB?.[account] !== undefined) return b.calcB[account];
  return v[c] ?? null;
}

/** Can this cell be typed in (before permissions)? */
export function oiInput(b: OiBlock, account: string, c: OiColumn): boolean {
  if (c !== 'OD' && c !== 'B') return false;
  if (c === 'B' && OI_ACCOUNT.get(account)?.calc === 'MF' && b.kind === 'P') return false;
  if (c === 'B' && b.calcB?.[account] !== undefined) return false;
  return true;
}
