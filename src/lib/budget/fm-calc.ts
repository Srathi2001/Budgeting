// FM cost budget calculation: monthly phasing of the works and the FM staff allocation to buildings,
// with the 2026 rules (FMD Labor_Allocation):
// - every team's cost to company + overtime carries the G&A share pro rata (total operating cost);
// - supervisory cost is split over work types (M1 19%, M2–M4 30%, R1/R2/R4 42%, R3 9%), each part over
//   the REHL / MJN buildings by their works of those types;
// - zone teams go to the buildings of their FM zone, the planned maintenance team to every building,
//   both by maintain (M01–M04) cost; the vacant unit team by vacant unit preparation (R03).
// Works: recurring types over 12 months; projects in the month planned (12 months when none is set).
import { SUPERVISED_BUS, SUPERVISION_SPLIT, WORK_TYPE, WORK_TYPES, type StaffTeam, type WorkType } from './fm-types';

export interface FmFacility {
  id: number;
  bu: string;
  zone: string | null;
}
export interface FmLineInput {
  propertyId: number;
  workType: string;
  amount: number;
  month: number | null;
}
export interface FmStaffInput {
  team: string;
  ctc: number;
  overtime: number;
}

export interface FmPropertyResult {
  works: Record<WorkType, number>;
  /** FM staff cost allocated to the building, by team */
  staff: Partial<Record<StaffTeam, number>>;
  staffTotal: number;
  monthly: { maintenance: number[]; capex: number[]; fmStaff: number[] };
}

export interface FmResult {
  byProperty: Map<number, FmPropertyResult>;
  /** total operating cost per team (cost to company + overtime + G&A share) */
  teamCost: Partial<Record<StaffTeam, number>>;
  /** staff cost with nowhere to go (e.g. a zone with no building) */
  unallocated: number;
}

const z12 = () => Array.from({ length: 12 }, () => 0);
const emptyWorks = () => Object.fromEntries(WORK_TYPES.map((w) => [w.code, 0])) as Record<WorkType, number>;
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

export function computeFm(facilities: FmFacility[], lines: FmLineInput[], staff: FmStaffInput[]): FmResult {
  const byProperty = new Map<number, FmPropertyResult>();
  const res = (id: number) => {
    let r = byProperty.get(id);
    if (!r) {
      r = { works: emptyWorks(), staff: {}, staffTotal: 0, monthly: { maintenance: z12(), capex: z12(), fmStaff: z12() } };
      byProperty.set(id, r);
    }
    return r;
  };
  for (const f of facilities) res(f.id);

  // works and their phasing
  for (const l of lines) {
    const wt = WORK_TYPE.get(l.workType as WorkType);
    if (!wt || !l.amount) continue;
    const r = res(l.propertyId);
    r.works[wt.code] += l.amount;
    const into = r.monthly[wt.line];
    if (wt.spread || !l.month) for (let i = 0; i < 12; i++) into[i] += l.amount / 12;
    else into[Math.min(Math.max(l.month, 1), 12) - 1] += l.amount;
  }

  // staff: total operating cost per team
  const raw = new Map<string, number>();
  for (const s of staff) raw.set(s.team, (raw.get(s.team) ?? 0) + (s.ctc || 0) + (s.overtime || 0));
  const ga = raw.get('GA') ?? 0;
  const base = sum([...raw].filter(([t]) => t !== 'GA').map(([, v]) => v));
  const gaRate = base > 0 ? ga / base : 0;
  const teamCost: Partial<Record<StaffTeam, number>> = {};
  for (const [t, v] of raw) if (t !== 'GA') teamCost[t as StaffTeam] = v * (1 + gaRate);

  let unallocated = 0;
  const allocate = (team: StaffTeam, amount: number, weights: [number, number][]) => {
    const total = sum(weights.map(([, w]) => w));
    if (!amount) return;
    if (total <= 0) {
      unallocated += amount;
      return;
    }
    for (const [id, w] of weights) {
      if (!w) continue;
      const r = res(id);
      const share = (amount * w) / total;
      r.staff[team] = (r.staff[team] ?? 0) + share;
    }
  };
  const maintain = (id: number) => { const w = res(id).works; return w.M01 + w.M02 + w.M03 + w.M04; };

  // supervisory: by work-type groups, over the supervised business units
  const sup = teamCost.SUPERVISORY ?? 0;
  const supervised = facilities.filter((f) => SUPERVISED_BUS.includes(f.bu));
  for (const part of SUPERVISION_SPLIT) {
    allocate('SUPERVISORY', sup * part.share, supervised.map((f) => [f.id, sum(part.workTypes.map((w) => res(f.id).works[w]))]));
  }
  // zone teams: buildings of the zone, by maintain cost
  for (const z of ['ZONE_1', 'ZONE_2', 'ZONE_3'] as const) {
    allocate(z, teamCost[z] ?? 0, facilities.filter((f) => f.zone === z).map((f) => [f.id, maintain(f.id)]));
  }
  allocate('PPM', teamCost.PPM ?? 0, facilities.map((f) => [f.id, maintain(f.id)]));
  allocate('VACANT', teamCost.VACANT ?? 0, facilities.map((f) => [f.id, res(f.id).works.R03]));

  for (const r of byProperty.values()) {
    r.staffTotal = sum(Object.values(r.staff).map((v) => v ?? 0));
    for (let i = 0; i < 12; i++) r.monthly.fmStaff[i] = r.staffTotal / 12;
  }
  return { byProperty, teamCost, unallocated };
}
