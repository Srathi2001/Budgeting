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
// ASRE (the mall operator, which pays REHL-MJN the mall rent) is not in the tool, so the group here is the
// budget's REHL / ANPM column; the mall rent elimination happens one level up, with ASRE.

import { OI_ACCOUNT } from './other-income-types';

export const GROUP_NAME = 'REHL / ANPM';
/** business units consolidated */
export const GROUP_BUS = ['501', '502', '521', '522'];
/** business units outside the group: shown for reference, never in group totals */
export const OUTSIDE_BUS = ['703', '751'];
/** business units whose properties are managed for their owners */
export const MANAGED_BUS = ['522'];
/** the Mall (Mirdiff / Arabian Center), a property of REHL-MJN reported on its own as in the budget */
export const isMall = (propertyCode: string | null | undefined) => !!propertyCode && /^10B131/i.test(propertyCode);

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
  { key: '751', label: 'MJNH', outside: true },
  { key: '703', label: 'MJN Private Office', outside: true },
] as const;
export type EntityKey = (typeof ENTITIES)[number]['key'];
