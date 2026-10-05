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

  // inputs
  tenant: string | null;
  vacant: boolean;
  staffOwner: string | null;
  mfCurrent: boolean | null;
  currentRent: number | null;
  currentStart: string | null;
  currentEnd: string | null;
  currentSchedule: ScheduleItem[] | null;
  securityDeposit: number | null;
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
  budgetRate: number | null;
  increasePctOverride: number | null;
  cheques: number | null;
  notes: string | null;

  // engine output
  current: DerivedContract | null;
  r1: DerivedContract | null;
  r2: DerivedContract | null;
  increasePct: number | null;
  reraAverage: number | null;
  vacancyLoss: number;
  warnings: string[];
  revenue: number[];
  cash: number[];
  cashFlow: number[];
  revenueTotal: number;
  cashTotal: number;
  cashFlowTotal: number;
  otherIncomeTotal: number;

  editable: boolean;
}

/** Fields a user can change from the grid. Unit-master fields update the unit itself. */
export const LINE_FIELDS = [
  'tenant',
  'vacant',
  'staffOwner',
  'mfCurrent',
  'currentRent',
  'currentStart',
  'currentEnd',
  'currentSchedule',
  'securityDeposit',
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
  'budgetRate',
  'increasePctOverride',
  'cheques',
  'notes',
] as const;

export const UNIT_FIELDS = ['bedroom', 'area', 'rc', 'pivotCategory', 'unitType', 'rooms', 'capacity'] as const;

export type LineField = (typeof LINE_FIELDS)[number];
export type UnitField = (typeof UNIT_FIELDS)[number];
export type RowPatch = Partial<Pick<MasterRow, LineField | UnitField>>;

export interface SaveResult {
  rows: MasterRow[];
  errors: { lineId: number; message: string }[];
}
