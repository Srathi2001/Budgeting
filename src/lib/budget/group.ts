// The group and its intergroup rules, as in the 2026 budget (H.E. MJN_Budget 2026: PnLxREHLxANPM and
// ConsolidatedxRealEstate). Shared by the server reports and the Other Income tab.
//
// - Group: REHL 501, REHL-MJN 502 (with the Mall), ANPM 521 and PMC 522.
// - Outside: MJNH 751 and MJN Private Office 703. Their income is not group income (the AMA fee REHL
//   pays MJNH stays a cost of the group); they are shown for reference only.
// - Owners' share: the PMC properties belong to the family landlords; ANPM only manages them. Their rent
//   and the landlord-side other income on them are not group income (only ANPM's fees are).
// - Intergroup: ANPM's PMA fee (52801 on ANPM's General row) is charged to REHL and REHL-MJN. The
//   matching cost is created from it (split by rent, as the budget's PMA at a % of each landlord's
//   revenue), and both sides are eliminated when the payers are in the selection.
// - ASRE (the mall operator) leases the Mall from REHL-MJN: its lease cost and the Mall's rent are eliminated
//   when both are in view, as ConsolidatedxRealEstate did. Its budget is entered in Admin → ASRE (asre.ts).

import { OI_ACCOUNT } from './other-income-types';

export const GROUP_NAME = 'REHL / ANPM';
/** business units consolidated */
export const GROUP_BUS = ['501', '502', '521', '522', 'ASRE'];
/** business units outside the group: shown for reference, never in group totals */
export const OUTSIDE_BUS = ['703', '751'];
/** business units whose properties are managed for their owners */
export const MANAGED_BUS = ['522'];
/** the Mall (Mirdiff / Arabian Center), a property of REHL-MJN reported on its own as in the budget */
// its property code prefixes are a mapping (Admin → Mappings, settings.ts sets them here; default 10B131)
let mallCodes: string[] = ['10B131'];
export const setMallCodes = (codes: string[]) => {
  if (codes.length) mallCodes = codes.map((c) => c.trim().toUpperCase()).filter(Boolean);
};
export const isMall = (propertyCode: string | null | undefined) => !!propertyCode && mallCodes.some((c) => propertyCode.toUpperCase().startsWith(c));
/** the entity a property reports under: its business unit, or MALL for the Mall (as the budget's columns) */
export const entityOf = (buCode: string, propertyCode: string | null | undefined): string => (isMall(propertyCode) ? 'MALL' : buCode);
/** the landlord entities that pay ANPM's PMA fee and its recharges */
export const LANDLORDS = ['501', '502', 'MALL'] as const;

/**
 * Cash of a monthly fee paid once a quarter, as the 2026 budget (CFxREHLxANPM): each quarter's total in
 * its first month ('advance': the PMA fee, Jan / Apr / Jul / Oct, row 28) or its last ('arrears': the AMA
 * fee, Mar / Jun / Sep / Dec, row 30). The expense stays monthly.
 */
export function quarterlyCash(months: number[], when: 'advance' | 'arrears'): number[] {
  const out = Array.from({ length: 12 }, () => 0);
  for (let q = 0; q < 4; q++) out[q * 3 + (when === 'advance' ? 0 : 2)] = months.slice(q * 3, q * 3 + 3).reduce((s, v) => s + v, 0);
  return out;
}

export interface IntergroupRule {
  /** the row and account that carry the income */
  scope: string;
  account: string;
  /** what it is, for the elimination lines */
  label: string;
  /** business units that pay it */
  payers: string[];
}

export const INTERGROUP: IntergroupRule[] = [{ scope: 'G:521', account: '52801', label: 'PMA fee', payers: ['501', '502'] }];
/** where ANPM's PMA fee sits in Other Income (calculated: the PMA rate × the landlords' rent) */
export const PMA_FEE = { scope: 'G:521', account: '52801' } as const;

export type GroupClass = 'group' | 'owners' | 'intergroup' | 'outside';

/** How an other income amount (row × account) counts for the group. */
export function classifyOtherIncome(scope: string, buCode: string, account: string): GroupClass {
  if (OUTSIDE_BUS.includes(buCode)) return 'outside';
  if (INTERGROUP.some((r) => r.scope === scope && r.account === account)) return 'intergroup';
  if (scope.startsWith('P:') && MANAGED_BUS.includes(buCode) && OI_ACCOUNT.get(account)?.side !== 'ANPM') return 'owners';
  return 'group';
}

/** How rent of a property counts for the group. */
export const classifyRent = (buCode: string): GroupClass => (OUTSIDE_BUS.includes(buCode) ? 'outside' : MANAGED_BUS.includes(buCode) ? 'owners' : 'group');

/** Columns of the group statement, in the budget's order. */
export const ENTITIES = [
  { key: '501', label: 'REHL', outside: false },
  { key: '502', label: 'REHL-MJN', outside: false },
  { key: 'MALL', label: 'Mall', outside: false },
  { key: '522', label: 'PMC', outside: false },
  { key: '521', label: 'ANPM', outside: false },
  // the mall operator: its budget comes from its own finance team (Admin → ASRE), blank until then
  { key: 'ASRE', label: 'ASRE', outside: false },
  { key: '751', label: 'MJNH', outside: true },
  { key: '703', label: 'MJN Private Office', outside: true },
] as const;
export type EntityKey = (typeof ENTITIES)[number]['key'];
