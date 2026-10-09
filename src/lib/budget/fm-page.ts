// FM Budget page data. Two tabs: the FM budget template (facilities with last year's budget and
// actuals; one facility opened in a side form with its facts from the tool and its budgeted costs) and
// the labour allocation (FM staff by team, spread over the facilities).
import 'server-only';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db, schema } from '@/db';
import { isFinance, isFm, type CurrentUser } from '@/lib/auth/dal';
import type { FmPropertyResult } from './fm-calc';
import { loadFmBudget } from './fm';
import { WORK_TYPES, isWorkType, type StaffTeam } from './fm-types';
import { staffEditBlocked } from './fm-save';
import { propertyRollups } from './reports';

type Status = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RETURNED';
export const STAFF_TEAM_ORDER: StaffTeam[] = ['SUPERVISORY', 'ZONE_1', 'ZONE_2', 'ZONE_3', 'PPM', 'VACANT', 'GA'];

export interface FmFacilityRow {
  id: number;
  code: string;
  name: string;
  bu: string;
  zone: string | null;
  status: Status;
  /** works budget last year (null: no budget version for last year) */
  prior: number | null;
  /** last year's actual to date (627xx / 117xx) */
  actual: number;
  /** works budget this version */
  budget: number;
  lines: number;
  /** FM staff allocated, by team, this version and last year */
  staff: Partial<Record<StaffTeam, number>>;
  staffTotal: number;
  priorStaffTotal: number | null;
}

export interface FmLineRow {
  id: number;
  workType: string;
  element: string;
  subElement: string | null;
  description: string | null;
  businessNeed: string | null;
  kind: string;
  amount: number;
  month: number | null;
  remarks: string | null;
  source: string;
}

export interface FmFacilityDetail {
  id: number;
  code: string;
  name: string;
  bu: string;
  buName: string;
  pm: string | null;
  zone: string | null;
  activeSince: string | null;
  grossArea: number | null;
  lettableArea: number;
  units: number;
  leased: number;
  vacant: number;
  /** current leases ending in the budget year without a renewal (Lease Budget) */
  moveOuts: number;
  revenue: number;
  priorRevenue: number | null;
  assets: Record<string, number> | null;
  /** by work type, then FM staff: last year's budget, last year's actual to date, this budget */
  compare: { key: string; label: string; prior: number | null; actual: number | null; budget: number }[];
  lines: FmLineRow[];
  status: Status;
  note: string | null;
  canEdit: boolean;
  reason: string | null;
}

export interface FmStaffRow {
  team: StaffTeam;
  ctc: number;
  overtime: number;
  /** with the G&A share */
  cost: number;
  prior: { ctc: number; overtime: number; cost: number } | null;
}

export interface FmPageData {
  version: { id: number; name: string; year: number; locked: boolean };
  priorLabel: string | null;
  actualLabel: string;
  facilities: FmFacilityRow[];
  detail: FmFacilityDetail | null;
  staff: FmStaffRow[];
  unallocated: number;
  canEditStaff: boolean;
  /** why the staff budget can't be changed right now (facilities submitted or approved) */
  staffLockedReason: string | null;
  finance: boolean;
}

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

/** why the user can't change a facility's FM budget (null: they can); the save path checks the same */
export function fmEditReason(locked: boolean, user: CurrentUser, status: Status): string | null {
  if (locked) return 'This budget version is locked';
  if (isFinance(user)) return null;
  if (!isFm(user)) return 'The FM budget is entered by facilities management';
  if (status === 'SUBMITTED' || status === 'APPROVED') return `This facility is ${status.toLowerCase()}; ask Finance to return it for changes`;
  return null;
}

/** The facilities with their lines and whether the user may change them: the Excel template and its upload. */
export async function loadFmTemplate(version: schema.BudgetVersion, user: CurrentUser, propertyIds: number[]) {
  const page = await loadFmPage(version, user, propertyIds, null);
  const ids = page.facilities.map((f) => f.id);
  const lines = ids.length
    ? await db
        .select()
        .from(schema.fmLines)
        .where(and(eq(schema.fmLines.versionId, version.id), inArray(schema.fmLines.propertyId, ids)))
        .orderBy(schema.fmLines.workType, schema.fmLines.element, schema.fmLines.id)
    : [];
  const facilities = page.facilities.map((f) => {
    const reason = fmEditReason(page.version.locked, user, f.status);
    return {
      id: f.id,
      code: f.code,
      name: f.name,
      bu: f.bu,
      zone: f.zone,
      prior: f.prior,
      actual: f.actual,
      budget: f.budget,
      status: f.status,
      editable: reason === null,
      reason,
      lines: lines
        .filter((l) => l.propertyId === f.id)
        .map((l) => ({ id: l.id, workType: l.workType, element: l.element, subElement: l.subElement, description: l.description, businessNeed: l.businessNeed, kind: l.kind, amount: l.amount, month: l.month, remarks: l.remarks, source: l.source })),
    };
  });
  return { page, facilities };
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const worksOf = (r: FmPropertyResult) => sum(Object.values(r.works));

export async function loadFmPage(version: schema.BudgetVersion, user: CurrentUser, propertyIds: number[], selected: number | null): Promise<FmPageData> {
  const year = version.year;
  const [prior] = await db
    .select()
    .from(schema.budgetVersions)
    .where(eq(schema.budgetVersions.year, year - 1))
    .orderBy(desc(schema.budgetVersions.id))
    .limit(1);
  const ids = propertyIds.length ? propertyIds : [-1];
  const [props, bus, subs, cur, prev, actuals, staffRows, priorStaffRows, lineCounts] = await Promise.all([
    db.select().from(schema.properties).where(inArray(schema.properties.id, ids)).orderBy(schema.properties.buCode, schema.properties.code),
    db.select().from(schema.businessUnits),
    db.select().from(schema.fmSubmissions).where(eq(schema.fmSubmissions.versionId, version.id)),
    loadFmBudget(version.id),
    prior ? loadFmBudget(prior.id) : null,
    db
      .select()
      .from(schema.fmActuals)
      .where(and(gte(schema.fmActuals.month, `${year - 1}-01`), lte(schema.fmActuals.month, `${year - 1}-12`))),
    db.select().from(schema.fmStaff).where(eq(schema.fmStaff.versionId, version.id)),
    prior ? db.select().from(schema.fmStaff).where(eq(schema.fmStaff.versionId, prior.id)) : Promise.resolve([]),
    db.select({ propertyId: schema.fmLines.propertyId }).from(schema.fmLines).where(eq(schema.fmLines.versionId, version.id)),
  ]);
  const subOf = new Map(subs.map((s) => [s.propertyId, s]));
  const nLines = new Map<number, number>();
  for (const l of lineCounts) nLines.set(l.propertyId, (nLines.get(l.propertyId) ?? 0) + 1);
  const lastMonth = actuals.reduce((m, a) => (a.month > m ? a.month : m), '');
  const actualLabel = lastMonth ? `${year - 1}A Jan–${MON[Number(lastMonth.slice(5)) - 1]}` : `${year - 1}A`;
  const actualBy = new Map<number, Map<string, number>>();
  for (const a of actuals) {
    if (a.propertyId === null) continue;
    const m = actualBy.get(a.propertyId) ?? new Map<string, number>();
    const wt = isWorkType(a.workType) ? a.workType : 'other';
    m.set(wt, (m.get(wt) ?? 0) + a.amount);
    actualBy.set(a.propertyId, m);
  }

  const facilities: FmFacilityRow[] = props
    .filter((p) => p.active)
    .map((p) => {
      const c = cur.result.byProperty.get(p.id);
      const pr = prev?.result.byProperty.get(p.id);
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        bu: p.buCode,
        zone: p.fmZone,
        status: subOf.get(p.id)?.status ?? 'DRAFT',
        prior: prev ? (pr ? worksOf(pr) : 0) : null,
        actual: sum([...(actualBy.get(p.id)?.values() ?? [])]),
        budget: c ? worksOf(c) : 0,
        lines: nLines.get(p.id) ?? 0,
        staff: c?.staff ?? {},
        staffTotal: c?.staffTotal ?? 0,
        priorStaffTotal: prev ? (pr?.staffTotal ?? 0) : null,
      };
    });

  const finance = isFinance(user);
  const locked = version.status === 'LOCKED';
  let detail: FmFacilityDetail | null = null;
  const pick = selected ? facilities.find((f) => f.id === selected) : undefined;
  if (pick) {
    const p = props.find((x) => x.id === pick.id)!;
    const [lines, units, leases, rolls, priorRolls] = await Promise.all([
      db
        .select()
        .from(schema.fmLines)
        .where(and(eq(schema.fmLines.versionId, version.id), eq(schema.fmLines.propertyId, p.id)))
        .orderBy(schema.fmLines.workType, schema.fmLines.element, schema.fmLines.id),
      db.select({ area: schema.units.area }).from(schema.units).where(and(eq(schema.units.propertyId, p.id), eq(schema.units.active, true))),
      db
        .select({
          vacant: schema.leaseLines.vacant,
          currentEnd: schema.leaseLines.currentEnd,
          renew1: schema.leaseLines.renew1,
          noRenewal: schema.leaseLines.noRenewal,
          contracted: schema.leaseLines.contracted,
          staffOwner: schema.leaseLines.staffOwner,
        })
        .from(schema.leaseLines)
        .where(and(eq(schema.leaseLines.versionId, version.id), eq(schema.leaseLines.propertyId, p.id))),
      propertyRollups(version.id, [p.id]),
      prior ? propertyRollups(prior.id, [p.id]) : Promise.resolve([]),
    ]);
    const c = cur.result.byProperty.get(p.id);
    const pr = prev?.result.byProperty.get(p.id);
    const act = actualBy.get(p.id);
    const sub = subOf.get(p.id);
    const status = sub?.status ?? 'DRAFT';
    const reason = fmEditReason(locked, user, status);
    const inYear = (d: string | null) => !!d && d >= `${year}-01-01` && d <= `${year}-12-31`;
    detail = {
      id: p.id,
      code: p.code,
      name: p.name,
      bu: p.buCode,
      buName: bus.find((b) => b.code === p.buCode)?.name ?? p.buCode,
      pm: p.coordinator,
      zone: p.fmZone,
      activeSince: p.fmActiveSince,
      grossArea: p.fmGrossArea,
      lettableArea: sum(units.map((u) => u.area ?? 0)),
      units: leases.length,
      leased: leases.filter((l) => !l.vacant).length,
      vacant: leases.filter((l) => l.vacant).length,
      moveOuts: leases.filter((l) => !l.vacant && l.staffOwner !== 'OWNER' && inYear(l.currentEnd) && l.contracted === 0 && (l.noRenewal || !l.renew1)).length,
      revenue: rolls[0] ? sum(rolls[0].revenue) : 0,
      priorRevenue: priorRolls[0] ? sum(priorRolls[0].revenue) : null,
      assets: p.fmAssets,
      compare: [
        ...WORK_TYPES.map((w) => ({ key: w.code, label: w.label, prior: prev ? (pr?.works[w.code] ?? 0) : null, actual: act?.get(w.code) ?? 0, budget: c?.works[w.code] ?? 0 })),
        ...(act?.get('other') ? [{ key: 'other', label: 'Booked without a work type', prior: null, actual: act.get('other')!, budget: 0 }] : []),
        { key: 'staff', label: 'FM staff (labour allocation)', prior: prev ? (pr?.staffTotal ?? 0) : null, actual: null, budget: c?.staffTotal ?? 0 },
      ],
      lines: lines.map((l) => ({
        id: l.id,
        workType: l.workType,
        element: l.element,
        subElement: l.subElement,
        description: l.description,
        businessNeed: l.businessNeed,
        kind: l.kind,
        amount: l.amount,
        month: l.month,
        remarks: l.remarks,
        source: l.source,
      })),
      status,
      note: sub?.note ?? null,
      canEdit: reason === null,
      reason,
    };
  }

  const raw = new Map(staffRows.map((s) => [s.team, s]));
  const rawPrior = new Map(priorStaffRows.map((s) => [s.team, s]));
  return {
    version: { id: version.id, name: version.name, year, locked },
    priorLabel: prior ? `${year - 1}B` : null,
    actualLabel,
    facilities,
    detail,
    staff: STAFF_TEAM_ORDER.map((t) => ({
      team: t,
      ctc: raw.get(t)?.ctc ?? 0,
      overtime: raw.get(t)?.overtime ?? 0,
      cost: t === 'GA' ? 0 : (cur.result.teamCost[t] ?? 0),
      prior: prev ? { ctc: rawPrior.get(t)?.ctc ?? 0, overtime: rawPrior.get(t)?.overtime ?? 0, cost: t === 'GA' ? 0 : (prev.result.teamCost[t] ?? 0) } : null,
    })),
    unallocated: cur.result.unallocated,
    canEditStaff: !locked && (finance || isFm(user)) && !staffEditBlocked(user, subs.map((x) => x.status)),
    staffLockedReason: locked ? 'This budget version is locked' : staffEditBlocked(user, subs.map((x) => x.status)),
    finance,
  };
}
