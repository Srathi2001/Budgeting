// Admin overheads (G&A): departments (Oracle cost centres), GL accounts, and the 2026 budget's rules
// (Admin(GA)xOverheads and PayrollxCost sheets of H.E. MJN_Budget 2026). Shared by server and browser.
//
// - Payroll is budgeted per department as totals from HR (headcount, cost to company), never per person.
// - FM (209) and Security (211) are budgeted elsewhere, as in 2026: FM staff and the FM G&A share in the
//   FM budget, security staff as watchmen in Building Overheads.
// - PDD payroll (100%) and slices of Finance, HR, PM and General are capitalised to projects; 21% of HR
//   is recharged to MJNH and 5% of Senior Management to ASRE (both outside the group); the rest is
//   ANPM's G&A, recovered from the landlords through the PMA fee.

import type { AdminItem, ItemKind } from './admin-items';

export interface Dept {
  code: string;
  name: string;
  /** budgeted in another module (FM budget, Building Overheads): reference only here */
  elsewhere?: string;
}

export const DEPTS: Dept[] = [
  { code: '214', name: 'Senior Management' },
  { code: '215', name: 'Operations Management' },
  { code: '206', name: 'Property Management' },
  { code: '201', name: 'Finance & Accounts' },
  { code: '207', name: 'Human Resources' },
  { code: '202', name: 'Legal' },
  { code: '208', name: 'Office Support' },
  { code: '212', name: 'Property Development' },
  { code: '106', name: "Mr. Mattar Mohammed's Office" },
  { code: '108', name: "Mr. Juma Mohammed's Office" },
  { code: '000', name: 'General' },
  { code: '209', name: 'Facility Management', elsewhere: 'FM Budget (FM staff and its G&A share)' },
  { code: '211', name: 'Security', elsewhere: 'Building Overheads (watchmen)' },
];
export const DEPT = new Map(DEPTS.map((d) => [d.code, d]));
export const deptName = (code: string) => DEPT.get(code)?.name ?? `Cost centre ${code}`;

/**
 * 2026 rules (PayrollxCost F:I and note B33). Capitalised to projects (PDD) and ASRE are shares of the
 * department's payroll plus the admin overheads ANPM pays for it; MJNH (SMAH) of its payroll only. ASRE
 * takes 5% of the senior staff of each department (PM 2026: 5% × 1,471,280.67), Senior Management in
 * full (`asreWhole`). Exco (family members) was nil in 2026: their payroll stays in G&A.
 */
export const DEFAULT_RULES: Record<string, { cap: number; mjnh: number; asre: number; asreWhole?: boolean }> = {
  '212': { cap: 1, mjnh: 0, asre: 0.05 },
  '201': { cap: 0.1, mjnh: 0, asre: 0.05 },
  '207': { cap: 0.05, mjnh: 0.21, asre: 0.05 },
  '206': { cap: 0.1, mjnh: 0, asre: 0.05 },
  '000': { cap: 0.05, mjnh: 0, asre: 0.05 },
  '214': { cap: 0, mjnh: 0, asre: 0.05, asreWhole: true },
};
export const ruleOf = (dept: string) => DEFAULT_RULES[dept] ?? { cap: 0, mjnh: 0, asre: 0.05 };

export type AdminGroup = 'Payroll' | 'Staff costs' | 'Office & admin' | 'Vehicles' | 'IT & communication' | 'Professional fees' | 'Insurance' | 'Depreciation' | 'Bank charges';

export interface AdminAccount {
  code: string;
  name: string;
  group: AdminGroup;
}

const A = (group: AdminGroup, list: [string, string][]): AdminAccount[] => list.map(([code, name]) => ({ code, name, group }));

/** names as in the GL (MJN HOLDING) */
export const ADMIN_ACCOUNTS: AdminAccount[] = [
  ...A('Payroll', [
    ['63101', 'Basic salary'],
    ['63102', 'House rent allowance'],
    ['63103', 'Transport allowance'],
    ['63106', 'Mobile allowance'],
    ['63107', 'Other allowance'],
    ['63108', 'Utility allowance'],
    ['63109', 'Children education allowance'],
    ['63111', 'Staff incentive / bonus'],
    ['63113', 'Outsourced manpower cost'],
    ['63114', 'Outsourced manpower - gratuity'],
    ['63115', 'Outsourced manpower - leave salary'],
    ['63116', 'Outsourced manpower - air fare'],
    ['63117', 'Outsourced manpower - incentive / bonus'],
    ['63151', 'Payroll - other'],
    ['63152', 'Payroll - other'],
    ['63201', 'Gratuity'],
    ['63202', 'Leave salary'],
    ['63203', 'Air fare'],
    ['63204', 'Pension fund (UAE national)'],
    ['63206', 'Payroll - other'],
    ['63251', 'Employee medical insurance'],
    ['63252', 'Visa charges - MOL'],
  ]),
  ...A('Staff costs', [
    ['63501', 'Recruitment consultancy fees'],
    ['63503', 'Staff visa - medical tests'],
    ['63504', 'Staff visa'],
    ['63505', 'Staff visa - renewal'],
    ['63506', 'Staff visa - air ticket'],
    ['63508', 'Staff visa - others'],
    ['63510', 'Staff uniform'],
    ['63601', 'Staff welfare - entertainment'],
    ['63602', 'Staff training'],
    ['63603', 'Staff welfare - other'],
    ['63605', 'Pantry / kitchen'],
  ]),
  ...A('Office & admin', [
    ['64201', 'Rent for office'],
    ['64306', 'Trade license fees'],
    ['64401', 'Advertisement'],
    ['64404', 'Gifts / donations'],
    ['64405', 'Business promotion - others'],
    ['64501', 'Stationery & supplies'],
    ['64502', 'Computer & printer consumables'],
    ['64503', 'Printing charges'],
    ['64504', 'Subscriptions & periodicals'],
    ['64505', 'Rubber stamps & banners'],
    ['64553', 'Repair & maintenance - office equipment'],
    ['64554', 'Office furnishing / decoration'],
    ['64556', 'Repair & maintenance - general'],
    ['64801', 'Office general expenses'],
    ['64802', 'Municipal charges'],
    ['64804', 'Fines & penalties'],
    ['64807', 'Office - other'],
  ]),
  ...A('Vehicles', [
    ['64651', 'Vehicle fuel'],
    ['64652', 'Vehicle repairs & maintenance'],
    ['64653', 'Vehicle parking / Salik'],
    ['64654', 'Vehicle cleaning'],
    ['64655', 'Vehicle registration'],
    ['64656', 'Vehicle hire'],
    ['64658', 'Vehicle - other'],
    ['64851', 'Rent a car'],
  ]),
  ...A('IT & communication', [
    ['64803', 'IT expenses'],
    ['64251', 'Telephone charges'],
    ['64252', 'Mobile / GSM charges'],
    ['64253', 'Internet charges'],
    ['64255', 'Telephone - other'],
  ]),
  ...A('Professional fees', [
    ['64301', 'Audit fees'],
    ['64303', 'Management consultancy'],
    ['64304', 'Technical consultancy'],
    ['64309', 'Legal charges'],
  ]),
  ...A('Insurance', [
    ['64601', 'Insurance - property all risks (office)'],
    ['64602', 'Insurance - equipment / vehicle'],
    ['64603', 'Insurance - workmen'],
    ['64606', 'Insurance - cash'],
    ['64607', 'Insurance - fidelity'],
    ['64608', 'Insurance - other'],
  ]),
  ...A('Depreciation', [
    ['65106', 'Depreciation - motor vehicles'],
    ['65107', 'Depreciation - furniture & fixtures'],
    ['65108', 'Depreciation - computers & office equipment'],
    ['65109', 'Depreciation - tools & equipment'],
  ]),
  ...A('Bank charges', [
    ['66201', 'Bank charges'],
    ['66202', 'Bank charges - other'],
    ['66203', 'Bank charges - POS & network'],
  ]),
];
export const ADMIN_ACCOUNT = new Map(ADMIN_ACCOUNTS.map((a) => [a.code, a]));
export const ADMIN_GROUPS: AdminGroup[] = ['Staff costs', 'Office & admin', 'Vehicles', 'IT & communication', 'Professional fees', 'Insurance', 'Depreciation', 'Bank charges'];
export const isPayrollAccount = (code: string) => ADMIN_ACCOUNT.get(code)?.group === 'Payroll';
/** salary allocated to buildings (FM staff, watchmen): a credit in payroll, shown apart */
export const SALARY_ALLOCATION = '63112';

/** companies that pay admin overheads */
export const PAYERS = [
  { code: '521', name: 'ANPM' },
  { code: '501', name: 'REHL' },
  { code: '502', name: 'REHL-MJN' },
] as const;
/** landlord entities that pay the PMA and AMA fees */
export const FEE_ENTITIES = [
  { key: '501', name: 'REHL' },
  { key: '502', name: 'REHL-MJN' },
  { key: 'MALL', name: 'Mall' },
] as const;
export type FeeEntity = (typeof FEE_ENTITIES)[number]['key'];

/** the companies ANPM's G&A is shared over by revenue (2026: PayrollxCost K:M; the mall is not in it) */
export const SPLIT_ENTITIES = [
  { key: '501', name: 'REHL' },
  { key: '502', name: 'REHL-MJN (without the mall)' },
  { key: '522', name: 'PMC' },
] as const;
export type SplitEntity = (typeof SPLIT_ENTITIES)[number]['key'];

/** the management fees: PMA to ANPM on the landlord's rent, AMA to MJNH on the asset value */
export const FEES = [
  { key: 'PMA', name: 'PMA fee to ANPM', base: 'Rent' },
  { key: 'AMA', name: 'AMA fee to MJNH', base: 'Asset value' },
] as const;
export type FeeKind = (typeof FEES)[number]['key'];

/**
 * Fees of past budgets kept outside the tool, by year: the 2026 final budget (H.E. MJN_Budget 2026.xlsm,
 * PnLxREHLxANPM row 31 "General Admin Cost (PMA@6%)" and row 33 "AMA … 0.5% on properties valuation").
 * The base is the fee ÷ the rate.
 */
export const PAST_FEES: Record<number, Record<FeeKind, { rate: number; fee: Record<FeeEntity, number> }>> = {
  2026: {
    PMA: { rate: 0.06, fee: { '501': 4046489.17, '502': 7975681.6, MALL: 3051000 } },
    AMA: { rate: 0.005, fee: { '501': 5638982.08, '502': 7332500, MALL: 3520000 } },
  },
};

export interface FeeRow {
  fee: FeeKind;
  entity: FeeEntity;
  /** last budget's rate, base and fee (the defaults), if known */
  prior: { rate: number; base: number | null; amount: number | null } | null;
  /** as entered (null = the default) */
  rate: number | null;
  base: number | null;
  /** the defaults: last budget's rate; PMA: this budget's rent, AMA: last budget's asset value */
  defaultRate: number;
  defaultBase: number | null;
  /** the fee: the rate × the base applied */
  amount: number | null;
}
export const feeRate = (r: Pick<FeeRow, 'rate' | 'defaultRate'>) => r.rate ?? r.defaultRate;
export const feeBase = (r: Pick<FeeRow, 'base' | 'defaultBase'>) => r.base ?? r.defaultBase;
export const feeAmount = (r: Pick<FeeRow, 'rate' | 'defaultRate' | 'base' | 'defaultBase'>) => {
  const b = feeBase(r);
  return b === null ? null : Math.round(b * feeRate(r) * 100) / 100;
};

/** actuals of Y-3, Y-2, Y-1 to date, and the Y-1 run-rate */
export interface Actual4 {
  a2: number | null;
  a1: number | null;
  ytd: number | null;
  f: number | null;
}

export interface PayrollRow extends Actual4 {
  dept: string;
  headcount: number | null;
  ctc: number | null;
  newHeadcount: number | null;
  newCtc: number | null;
  /** the rules as stored (null = default) and as applied */
  capPct: number | null;
  mjnhPct: number | null;
  asrePct: number | null;
  /** cost to company of the department's senior staff: ASRE's share is taken on it (null: none; Senior Management: the whole department) */
  seniorCtc: number | null;
}

export interface AdminRow extends Actual4 {
  dept: string;
  account: string;
  /** budget typed by paying company */
  b: Record<string, number | null>;
  /** budget from the back-up schedules by paying company (replaces the typed amount where there is one) */
  items: Record<string, number | null>;
  /** the schedule tab this account is entered in (no typed amount in the Overview), if it has one */
  schedule: ItemKind | null;
}

export interface AdminData {
  year: number;
  cutoff: number;
  payroll: PayrollRow[];
  admin: AdminRow[];
  /** FM and security payroll budgeted in other modules (2027B, for reference) */
  elsewhere: { dept: string; budget: number | null }[];
  /** salary allocated to buildings (63112), actuals */
  allocation: Actual4;
  /** PMA and AMA fees per landlord entity */
  fees: FeeRow[];
  /** the budget the fee defaults come from (e.g. 2026B), if any */
  feesPrior: string | null;
  /** budget rent by company, the base ANPM's G&A is shared on (REHL-MJN without the mall) */
  revenue: Record<SplitEntity, number>;
  /** back-up schedule items (vehicles, telephones, training, events, IT, capex, other) */
  items: AdminItem[];
}

export type PayrollField = 'headcount' | 'ctc' | 'newHeadcount' | 'newCtc' | 'capPct' | 'mjnhPct' | 'asrePct' | 'seniorCtc';
export type AdminChange =
  | { kind: 'payroll'; dept: string; field: PayrollField; value: number | null }
  | { kind: 'admin'; dept: string; account: string; entity: string; value: number | null }
  | { kind: 'fee'; fee: FeeKind; entity: FeeEntity; field: 'rate' | 'base'; value: number | null };

/**
 * A department's payroll budget and how it splits under the 2026 rules (PayrollxCost): `oh` is the admin
 * overheads ANPM pays for the department. Capitalised (PDD) and ASRE come off payroll + overheads, MJNH
 * off payroll; `net` is what stays in ANPM's G&A of the two together.
 */
export function payrollSplit(r: Pick<PayrollRow, 'dept' | 'ctc' | 'newCtc' | 'capPct' | 'mjnhPct' | 'asrePct' | 'seniorCtc'>, oh = 0) {
  const total = (r.ctc ?? 0) + (r.newCtc ?? 0);
  const rule = ruleOf(r.dept);
  const base = total + oh;
  const cap = base * (r.capPct ?? rule.cap);
  const mjnh = total * (r.mjnhPct ?? rule.mjnh);
  const asreBase = r.seniorCtc ?? (rule.asreWhole ? base : 0);
  const asre = asreBase * (r.asrePct ?? rule.asre);
  return { total, oh, base, cap, mjnh, asre, asreBase, net: base - cap - mjnh - asre };
}

/** the admin overheads ANPM pays, by department (the schedules' amount where there is one) */
export function anpmOverheads(rows: Pick<AdminRow, 'dept' | 'b' | 'items'>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.dept, (out.get(r.dept) ?? 0) + (r.items['521'] ?? r.b['521'] ?? 0));
  return out;
}
