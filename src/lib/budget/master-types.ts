// Shared between the server (loading/saving) and the Lease Budget grid.

export interface ScheduleItem {
  date: string; // YYYY-MM-DD
  amount: number; // ex VAT
}

export type ScheduleSource = 'ACTUAL' | 'CUSTOM' | 'EQUAL';

export interface DerivedContract {
  rent: number;
  start: string | null;
  end: string | null;
  mf: boolean;
  schedule: ScheduleItem[];
  scheduleSource: ScheduleSource;
}

export interface MasterRow {
  lineId: number;
  unitId: number;
  propertyId: number;
  buCode: string;
  buName: string;
  coordinator: string | null;
  propertyCode: string;
  propertyName: string;
  propertyKind: 'BUILDING' | 'CAMP' | 'MALL';
  unitCode: string;

  // unit master
  bedroom: string | null;
  area: number | null;
  rc: string;
  pivotCategory: string | null;
  unitType: string | null;
  rooms: number | null;
  capacity: number | null;
  mergedUnitNumber: string | null;
  unitStatus: string | null;
  resiCommercial: string | null;
  landlord: string | null;

  // current lease: Oracle Fusion (read-only)
  leaseNumber: string | null;
  leaseVersion: string | null;
  tenantCode: string | null;
  tenant: string | null;
  customerClass: string | null;
  currentStart: string | null;
  rentStart: string | null;
  currentEnd: string | null;
  currentRent: number | null;
  vatAmount: number | null;
  securityDeposit: number | null;
  /** other income on the current contract (Oracle); not part of rent revenue */
  maintenanceFee: number | null;
  utilityFee: number | null;
  carParkFee: number | null;
  leaseStatus: string | null;
  leaseRemarks: string | null;
  currentSchedule: ScheduleItem[] | null;
  leaseSyncedAt: string | null;
  vacant: boolean;

  // budget inputs (property managers)
  staffOwner: string | null;
  mfCurrent: boolean | null;
  renew1: boolean;
  noRenewal: boolean;
  r1Rent: number | null;
  r1Start: string | null;
  r1End: string | null;
  r1Mf: boolean | null;
  r1Schedule: ScheduleItem[] | null;
  r2Renew: boolean | null;
  r2Rent: number | null;
  r2Start: string | null;
  r2End: string | null;
  r2Mf: boolean | null;
  r2Schedule: ScheduleItem[] | null;
  r3Renew: boolean | null;
  r3Rent: number | null;
  r3Start: string | null;
  r3End: string | null;
  r3Mf: boolean | null;
  r3Schedule: ScheduleItem[] | null;
  budgetRate: number | null;
  increasePctOverride: number | null;
  cheques: number | null;
  notes: string | null;
  /** how many renewals (1st, 2nd, 3rd) are contracted lease years from Oracle */
  contracted: number;

  // engine output
  current: DerivedContract | null;
  r1: DerivedContract | null;
  r2: DerivedContract | null;
  r3: DerivedContract | null;
  increasePct: number | null;
  reraGap: number | null;
  reraAverage: number | null;
  reraMin: number | null;
  reraMax: number | null;
  vacancyLoss: number;
  warnings: string[];
  revenue: number[];
  cash: number[];
  cashFlow: number[];
  revenueTotal: number;
  cashTotal: number;
  cashFlowTotal: number;

  editable: boolean;
}

/** Fields a user can change. Current-lease fields are also loaded from Fusion (an upload overwrites them). */
export const LINE_FIELDS = [
  'leaseNumber',
  'leaseVersion',
  'tenantCode',
  'tenant',
  'customerClass',
  'currentStart',
  'rentStart',
  'currentEnd',
  'currentRent',
  'vatAmount',
  'securityDeposit',
  'leaseStatus',
  'leaseRemarks',
  'currentSchedule',
  'vacant',
  'staffOwner',
  'mfCurrent',
  'renew1',
  'noRenewal',
  'r1Rent',
  'r1Start',
  'r1End',
  'r1Mf',
  'r1Schedule',
  'r2Renew',
  'r2Rent',
  'r2Start',
  'r2End',
  'r2Mf',
  'r2Schedule',
  'r3Renew',
  'r3Rent',
  'r3Start',
  'r3End',
  'r3Mf',
  'r3Schedule',
  'budgetRate',
  'increasePctOverride',
  'cheques',
  'notes',
] as const;

/** Unit master fields editable in the tool (a Fusion Unit Dump upload overwrites status / merged no. / usage / landlord). */
export const UNIT_FIELDS = [
  'bedroom',
  'area',
  'rc',
  'pivotCategory',
  'unitType',
  'rooms',
  'capacity',
  'landlord',
  'mergedUnitNumber',
  'unitStatus',
  'resiCommercial',
] as const;

/**
 * Fields that come from Oracle (the Tenant and Lease Details Report import): only an admin may
 * change them in the tool, and the next import overwrites them.
 */
export const ORACLE_FIELDS = [
  'area',
  'unitStatus',
  'resiCommercial',
  'mergedUnitNumber',
  'landlord',
  'leaseNumber',
  'leaseVersion',
  'tenantCode',
  'tenant',
  'customerClass',
  'rentStart',
  'currentStart',
  'currentEnd',
  'currentRent',
  'vatAmount',
  'securityDeposit',
  'leaseStatus',
  'leaseRemarks',
  'vacant',
] as const;

/** Fields fixed by contracted lease years (the first `contracted` renewals), plus the outcome they settle. */
export function contractedFields(contracted: number): string[] {
  const out: string[] = contracted > 0 ? ['renew1', 'noRenewal'] : [];
  for (let i = 1; i <= Math.min(contracted, 3); i++) out.push(`r${i}Rent`, `r${i}Start`, `r${i}End`, ...(i > 1 ? [`r${i}Renew`] : []));
  return out;
}

/** Fields of this row that only an admin may change. */
export function adminOnlyFields(contracted: number): Set<string> {
  return new Set<string>([...ORACLE_FIELDS, ...contractedFields(contracted)]);
}

export type LineField = (typeof LINE_FIELDS)[number];
export type UnitField = (typeof UNIT_FIELDS)[number];
export type RowPatch = Partial<Pick<MasterRow, LineField | UnitField>>;

export interface SaveResult {
  rows: MasterRow[];
  errors: { lineId: number; message: string }[];
}
