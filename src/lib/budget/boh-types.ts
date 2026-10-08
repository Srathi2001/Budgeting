// Building overheads: the GL accounts budgeted per building, the Building P&L line each one feeds, who
// enters it and how it is phased. The list follows the 2026 budget (Bx BOH Master 2026B /
// BuildingxOverheads) on the accounts the GL actually books per building. Shared by server and browser.
// Not here: FM works (627xx, 117xx) and FM staff (62326) come from the FM budget; company-level lines
// are G&A (Admin overheads).

/** Building P&L line (an EXPENSE_LINES key) */
export type BohLine = 'utilities' | 'watchmen' | 'insurance' | 'cleaning' | 'overheads' | 'land';

/**
 * flat: ÷ 12 (contracts, subscriptions; insurance too: the GL spreads the premium over the policy
 * year); seasonal: the portfolio's monthly pattern (water & electricity, about twice as high in
 * summer); due: in full in the month it is paid (civil defence, service charges).
 */
export type BohPhasing = 'flat' | 'seasonal' | 'due';

/** PM: the property manager (and Finance); FIN: Finance only */
export type BohOwner = 'PM' | 'FIN';

export interface BohAccount {
  code: string;
  name: string;
  line: BohLine;
  owner: BohOwner;
  phasing: BohPhasing;
  /** heading the account is listed under within its line */
  group?: string;
  /** expensed over the year (phasing) but paid in one month: the cash flow takes it in the month paid (insurance premiums) */
  paidUpfront?: boolean;
}

export const BOH_LINES: { key: BohLine; label: string }[] = [
  { key: 'utilities', label: 'Water & electricity' },
  { key: 'watchmen', label: 'Watchmen' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'cleaning', label: 'Cleaning & security' },
  { key: 'overheads', label: 'Miscellaneous overheads' },
  { key: 'land', label: 'DREC / land & service charges' },
];
export const BOH_LINE_LABEL = Object.fromEntries(BOH_LINES.map((l) => [l.key, l.label])) as Record<BohLine, string>;

const OUTSIDE_FM = 'Repairs & AMCs outside the FM budget';

export const BOH_ACCOUNTS: BohAccount[] = [
  { code: '62324', name: 'Water & electricity', line: 'utilities', owner: 'FIN', phasing: 'seasonal' },
  { code: '62603', name: 'Staff cost - watchmen', line: 'watchmen', owner: 'FIN', phasing: 'flat' },
  { code: '64601', name: 'Insurance - property all risks (PAR)', line: 'insurance', owner: 'FIN', phasing: 'flat', paidUpfront: true },
  { code: '64604', name: 'Insurance - public liability', line: 'insurance', owner: 'FIN', phasing: 'flat', paidUpfront: true },
  { code: '62503', name: 'Insurance - other', line: 'insurance', owner: 'FIN', phasing: 'flat', paidUpfront: true },
  { code: '62502', name: 'Cleaning - AMC', line: 'cleaning', owner: 'PM', phasing: 'flat' },
  { code: '62611', name: 'Cleaning - direct', line: 'cleaning', owner: 'PM', phasing: 'flat' },
  { code: '62504', name: 'Security - AMC', line: 'cleaning', owner: 'PM', phasing: 'flat' },
  { code: '62610', name: 'Security - direct', line: 'cleaning', owner: 'PM', phasing: 'flat' },
  { code: '62218', name: 'Window cleaning - AMC', line: 'cleaning', owner: 'PM', phasing: 'flat' },
  { code: '62123', name: 'Window cleaning - direct', line: 'cleaning', owner: 'PM', phasing: 'flat' },
  { code: '62207', name: 'Landscaping - AMC', line: 'cleaning', owner: 'PM', phasing: 'flat' },
  { code: '62110', name: 'Landscaping - direct', line: 'cleaning', owner: 'PM', phasing: 'flat' },
  { code: '62401', name: 'Cleaning materials', line: 'overheads', owner: 'PM', phasing: 'flat' },
  { code: '62402', name: 'Sewage / waste disposal', line: 'overheads', owner: 'PM', phasing: 'flat' },
  { code: '62105', name: 'Garbage equipment', line: 'overheads', owner: 'PM', phasing: 'flat' },
  { code: '62210', name: 'Pest control - AMC', line: 'overheads', owner: 'PM', phasing: 'flat' },
  { code: '62115', name: 'Pest control - direct', line: 'overheads', owner: 'PM', phasing: 'flat' },
  { code: '62119', name: 'Telephone - direct', line: 'overheads', owner: 'PM', phasing: 'flat' },
  { code: '64251', name: 'Telephone charges', line: 'overheads', owner: 'PM', phasing: 'flat' },
  { code: '64253', name: 'Internet charges', line: 'overheads', owner: 'PM', phasing: 'flat' },
  { code: '62122', name: 'TV antenna', line: 'overheads', owner: 'PM', phasing: 'flat' },
  { code: '62609', name: 'Maintenance tools', line: 'overheads', owner: 'PM', phasing: 'flat' },
  { code: '64401', name: 'Advertisement', line: 'overheads', owner: 'PM', phasing: 'flat' },
  { code: '62501', name: 'Civil defence subscription', line: 'overheads', owner: 'FIN', phasing: 'due' },
  // a yearly fee per building: paid once a year
  { code: '64802', name: 'Municipal charges', line: 'overheads', owner: 'FIN', phasing: 'due' },
  { code: '64303', name: 'Management consultancy', line: 'overheads', owner: 'FIN', phasing: 'flat' },
  { code: '62606', name: 'Consultancy - property', line: 'overheads', owner: 'FIN', phasing: 'flat' },
  { code: '64304', name: 'Technical consultancy', line: 'overheads', owner: 'FIN', phasing: 'flat' },
  { code: '64309', name: 'Legal charges', line: 'overheads', owner: 'FIN', phasing: 'flat' },
  // buildings managed by a third party (e.g. Al Sabkha) book repairs and AMCs outside the FM work types
  ...(
    [
      ['62101', 'Air conditioning - direct'],
      ['62102', 'Carpentry - direct'],
      ['62103', 'Electrical - direct'],
      ['62104', 'Fire fighting - direct'],
      ['62111', 'Lifts - direct'],
      ['62112', 'Masonry - direct'],
      ['62114', 'Painting - direct'],
      ['62116', 'Plumbing - direct'],
      ['62118', 'Swimming pool - direct'],
      ['62120', 'Tiles & marble - direct'],
      ['62121', 'Traffic barriers - direct'],
      ['62201', 'Air conditioning - AMC'],
      ['62205', 'Fire fighting - AMC'],
      ['62208', 'Lifts - AMC'],
    ] as const
  ).map(([code, name]) => ({ code, name, line: 'overheads' as const, owner: 'PM' as const, phasing: 'flat' as const, group: OUTSIDE_FM })),
  { code: '62608', name: 'Master community charges', line: 'land', owner: 'FIN', phasing: 'due' },
  { code: '62604', name: 'DIP fees', line: 'land', owner: 'FIN', phasing: 'due' },
  { code: '62602', name: 'Land rent', line: 'land', owner: 'FIN', phasing: 'due' },
  { code: '62601', name: 'Tax DREC', line: 'land', owner: 'FIN', phasing: 'due' },
];
export const BOH_ACCOUNT = new Map(BOH_ACCOUNTS.map((a) => [a.code, a]));
export const isBohNatural = (natural: string) => BOH_ACCOUNT.has(natural);
/** the account is paid in one month (lump sums, and premiums paid upfront): its payment month can be set */
export const paidInOneMonth = (a: BohAccount) => a.phasing === 'due' || !!a.paidUpfront;

/** Reference columns (actuals by year, the year to date, the forecast) and the budget. */
export type BohColumn = 'A2' | 'A1' | 'YTD' | 'F' | 'B';

export interface BohRow {
  account: string;
  /** actuals of Y-3, Y-2, Y-1 to the last month in the GL */
  a2: number | null;
  a1: number | null;
  ytd: number | null;
  /** Y-1 forecast, by how the line is paid (run-rate, year to date + last year's remaining months, or the payment) */
  f: number | null;
  /** budget amount used (entered, or calculated: see `calc`), null = none */
  b: number | null;
  /** the amount typed in (null = none) */
  entered: number | null;
  /** how `b` is calculated: null = as entered */
  calc: BohCalc | null;
  dueMonth: number | null;
  /** due month used when none is entered: last year's largest payment, else January */
  defaultDue: number;
}

export interface BohBlock {
  propertyId: number;
  code: string;
  name: string;
  buCode: string;
  buName: string;
  pm: string | null;
  /** the property can be edited by the user (PM lines); Finance lines need Finance as well */
  editable: boolean;
  rows: BohRow[];
}

export interface BohChange {
  propertyId: number;
  account: string;
  amount: number | null;
  dueMonth: number | null;
}

/**
 * A calculated budget:
 * water: the forecast × (1 + %) · insurance: insured value × rate, or the liability premium, × (1 + %) ·
 * watchmen: share × cost per watchman · contracts: the building's contract schedule ·
 * forecast: last year's forecast, until an amount is entered (municipal charges).
 */
export type BohCalc = 'water' | 'insurance' | 'watchmen' | 'contracts' | 'forecast';
export const BOH_CALC_NOTE: Record<BohCalc, string> = {
  water: 'Forecast × (1 + the water & electricity %), see Assumptions',
  insurance: 'Insured value × rate (PAR), or the premium (public liability), × (1 + %), see Assumptions',
  watchmen: 'Watchmen × cost per watchman, see Security allocation',
  contracts: 'Total of the contract schedule',
  forecast: 'Last year’s forecast until an amount is entered',
};

// ---- contract schedules (AMC tabs) ------------------------------------------------------------

export type ContractKind = 'security' | 'cleaning' | 'pest' | 'waste' | 'materials' | 'telecom';
export interface ContractKindInfo {
  kind: ContractKind;
  label: string;
  /** accounts a row of this schedule can book to (first = default) */
  accounts: string[];
  /** what quantity × rate means here */
  quantity: string;
  rate: string;
}
export const CONTRACT_KINDS: ContractKindInfo[] = [
  { kind: 'security', label: 'Security AMC', accounts: ['62504', '62610'], quantity: 'Months', rate: 'Monthly fee' },
  { kind: 'cleaning', label: 'Cleaning AMC', accounts: ['62502', '62218', '62207', '62611', '62123', '62110'], quantity: 'Months / visits', rate: 'Fee' },
  { kind: 'pest', label: 'Pest control', accounts: ['62210', '62115'], quantity: 'Visits / months', rate: 'Fee' },
  { kind: 'waste', label: 'Waste disposal', accounts: ['62402', '62105'], quantity: 'Collections a year', rate: 'Rate' },
  { kind: 'materials', label: 'Cleaning materials', accounts: ['62401', '62609'], quantity: 'Quantity', rate: 'Rate' },
  { kind: 'telecom', label: 'Telephone & internet', accounts: ['62119', '64253', '64251', '62122'], quantity: 'Months', rate: 'Monthly charge' },
];
export const CONTRACT_KIND = new Map(CONTRACT_KINDS.map((k) => [k.kind, k]));
export const isContractKind = (s: unknown): s is ContractKind => CONTRACT_KIND.has(s as ContractKind);
/** schedule of an account (accounts in a schedule are budgeted by it once a building has rows) */
export const CONTRACT_KIND_OF = new Map(CONTRACT_KINDS.flatMap((k) => k.accounts.map((a) => [a, k.kind] as const)));

export const CONTRACT_TERMS = ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly', 'One-off'] as const;
export type ContractTerms = (typeof CONTRACT_TERMS)[number];

export interface ContractRow {
  id: number;
  propertyId: number;
  kind: ContractKind;
  account: string;
  supplier: string | null;
  description: string | null;
  terms: ContractTerms;
  quantity: number;
  rate: number;
  startMonth: number | null;
  remarks: string | null;
  source: 'PO' | 'PM';
  poNumber: string | null;
  poCategory: string | null;
  poStatus: string | null;
  poQuantity: number | null;
  poRate: number | null;
  poAmount: number | null;
}

/** Monthly phasing of an annual amount. `pattern`: last year's monthly actuals (seasonal lines). */
export function phase(amount: number, phasing: BohPhasing, due: number, pattern?: number[] | null): number[] {
  const out = Array.from({ length: 12 }, () => 0);
  if (!amount) return out;
  if (phasing === 'due') {
    out[Math.min(Math.max(due, 1), 12) - 1] = amount;
    return out;
  }
  const total = pattern ? pattern.reduce((s, v) => s + Math.max(v, 0), 0) : 0;
  if (phasing === 'seasonal' && pattern && total > 0) return pattern.map((v) => (amount * Math.max(v, 0)) / total);
  return out.map(() => amount / 12);
}
