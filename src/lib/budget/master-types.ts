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

/** Budget inputs a property manager can change. Current-lease facts come from Fusion only. */
export const LINE_FIELDS = [
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

/** Unit master fields editable in the tool until the Fusion unit sync takes them over. */
export const UNIT_FIELDS = ['bedroom', 'area', 'rc', 'pivotCategory', 'unitType', 'rooms', 'capacity', 'landlord'] as const;

export type LineField = (typeof LINE_FIELDS)[number];
export type UnitField = (typeof UNIT_FIELDS)[number];
export type RowPatch = Partial<Pick<MasterRow, LineField | UnitField>>;

export interface SaveResult {
  rows: MasterRow[];
  errors: { lineId: number; message: string }[];
}
