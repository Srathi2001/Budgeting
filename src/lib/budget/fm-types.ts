// Facilities Management (FM) cost budget: work types, building elements (GL accounts), line types and
// staff teams, as in the FMD budget template (FMD_Budget_2026_Rev.2). Shared by server and browser.

export type WorkType = 'M01' | 'M02' | 'M03' | 'M04' | 'R01' | 'R02' | 'R03' | 'R04';

export interface WorkTypeInfo {
  code: WorkType;
  label: string;
  /** Maintain (expense) or Renewal */
  group: 'Maintain' | 'Renewal';
  /** recurring work, spread over 12 months; projects (renewal) are booked in the month planned */
  spread: boolean;
  /** Building P&L / statements line: maintenance cost, or capex & replacements (as in the 2026 budget) */
  line: 'maintenance' | 'capex';
}

export const WORK_TYPES: WorkTypeInfo[] = [
  { code: 'M01', label: 'Outsourced maintenance contracts', group: 'Maintain', spread: true, line: 'maintenance' },
  { code: 'M02', label: 'Reactive maintenance', group: 'Maintain', spread: true, line: 'maintenance' },
  { code: 'M03', label: 'Inspections & surveys', group: 'Maintain', spread: true, line: 'maintenance' },
  { code: 'M04', label: 'In-house planned maintenance', group: 'Maintain', spread: true, line: 'maintenance' },
  { code: 'R01', label: 'Major repairs & replacements', group: 'Renewal', spread: false, line: 'capex' },
  { code: 'R02', label: 'Refurbishment & retrofit', group: 'Renewal', spread: false, line: 'capex' },
  // vacant unit preparation sits in maintenance cost in the 2026 Building P&L (R03 + Ms)
  { code: 'R03', label: 'Vacant unit preparation', group: 'Renewal', spread: true, line: 'maintenance' },
  { code: 'R04', label: 'Capex items', group: 'Renewal', spread: false, line: 'capex' },
];
export const WORK_TYPE = new Map(WORK_TYPES.map((w) => [w.code, w]));
export const isWorkType = (s: string): s is WorkType => WORK_TYPE.has(s as WorkType);

/** Building elements: GL 627xx (maintain / renewal works); capex items use the same element as 117xx. */
export const ELEMENTS: { code: string; label: string }[] = [
  { code: '01', label: 'Substructure' },
  { code: '02', label: 'Superstructure' },
  { code: '03', label: 'External enclosure' },
  { code: '04', label: 'Interior construction' },
  { code: '05', label: 'Interior finishes' },
  { code: '06', label: 'Furniture, fittings & equipment' },
  { code: '07', label: 'Conveying systems' },
  { code: '08', label: 'Sanitary appliances' },
  { code: '09', label: 'Sanitary fittings' },
  { code: '10', label: 'Building drainage' },
  { code: '11', label: 'Water installations' },
  { code: '12', label: 'Air conditioning' },
  { code: '13', label: 'Ventilation' },
  { code: '14', label: 'Heating' },
  { code: '15', label: 'Electrical' },
  { code: '16', label: 'Fuel installations' },
  { code: '17', label: 'Fire protection' },
  { code: '18', label: 'Communication, security & control' },
  { code: '19', label: 'Specialist installations' },
  { code: '20', label: "Builder's work in services" },
  { code: '21', label: 'External works' },
  { code: '22', label: "Builder's work, external services" },
  { code: '23', label: 'Soft landscaping' },
  { code: '24', label: 'Redecoration works' },
  { code: '25', label: 'Refurbishment & retrofits' },
  { code: '26', label: 'Facility inspections & condition surveys' },
  { code: '27', label: 'Masonry repairs' },
  { code: '28', label: 'Concrete repairs' },
  { code: '29', label: 'Metal repairs' },
  { code: '30', label: 'Carpentry repairs' },
  { code: '31', label: 'Painting works' },
  { code: '32', label: 'Other repair works' },
  { code: '33', label: 'Consultant & specialist fees' },
  { code: '34', label: 'Asset information costs' },
  { code: '35', label: 'Vacant unit inspection' },
  { code: '36', label: 'Total facilities management' },
  { code: '37', label: 'Temporary facilities & services' },
];

/** GL account of a line: 117xx for capex items, 627xx otherwise */
export const glOf = (workType: string, element: string) => `${workType === 'R04' ? '117' : '627'}${element}`;
export const elementLabel = (element: string) => ELEMENTS.find((e) => e.code === element)?.label ?? element;
/** element code from a GL account (62707 / 11707 → 07) */
export const elementOfGl = (gl: string) => gl.slice(3, 5);

export type FmKind = 'PLANNED' | 'PROVISIONAL' | 'COMMITTED';
export const FM_KINDS: { code: FmKind; label: string; hint: string }[] = [
  { code: 'PLANNED', label: 'Planned', hint: 'Work needed to run the building' },
  { code: 'PROVISIONAL', label: 'Provisional', hint: 'Only if the need arises (e.g. beyond economical repair)' },
  { code: 'COMMITTED', label: 'Open commitment', hint: 'Ordered last year, paid this year' },
];
export const FM_KIND_LABEL = Object.fromEntries(FM_KINDS.map((k) => [k.code, k.label])) as Record<FmKind, string>;

export const BUSINESS_NEEDS = ['Statutory', 'Business-Critical', 'Functional', 'Optional'] as const;

/** FM staff teams, as in Labor_Allocation (2026). */
export type StaffTeam = 'SUPERVISORY' | 'ZONE_1' | 'ZONE_2' | 'ZONE_3' | 'PPM' | 'VACANT' | 'GA';
export const STAFF_TEAMS: { code: StaffTeam; label: string; hint: string }[] = [
  { code: 'SUPERVISORY', label: 'Office / supervisory', hint: 'Spread by the supervision split over work types' },
  { code: 'ZONE_1', label: 'Zone 1 team', hint: 'Spread over Zone 1 buildings by their maintain cost' },
  { code: 'ZONE_2', label: 'Zone 2 team', hint: 'Spread over Zone 2 buildings by their maintain cost' },
  { code: 'ZONE_3', label: 'Zone 3 team', hint: 'Spread over Zone 3 buildings by their maintain cost' },
  { code: 'PPM', label: 'Planned maintenance team', hint: 'Spread over all buildings by their maintain cost' },
  { code: 'VACANT', label: 'Vacant unit team', hint: 'Spread by vacant unit preparation (R03)' },
  { code: 'GA', label: 'G&A share', hint: 'Department overheads, added to every team pro rata' },
];

/** Supervisory cost split over work types (2026 Labor_Allocation: M1 19%, M2–M4 30%, R1/R2/R4 42%, R3 9%). */
export const SUPERVISION_SPLIT: { share: number; workTypes: WorkType[] }[] = [
  { share: 0.19, workTypes: ['M01'] },
  { share: 0.3, workTypes: ['M02', 'M03', 'M04'] },
  { share: 0.42, workTypes: ['R01', 'R02', 'R04'] },
  { share: 0.09, workTypes: ['R03'] },
];
/** business units supervision is spread over (2026: "Supervisory % 501, 502"; PMC none) */
export const SUPERVISED_BUS = ['501', '502'];
