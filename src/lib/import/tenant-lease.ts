// Units and current leases from the "Tenant and Lease Details Report" (Oracle ReportsApp export).
//
// The report has one row per unit per contract year: every unit of every BU, leased or available,
// with the lease's yearly contract periods. A lease on several units (merged units, camps, whole
// buildings) repeats on each of its units. Personal data columns (mobile, email, passport, Emirates
// ID, addresses) are never read.
//
// planImport() works out what would change without writing anything (the preview);
// applyImport() writes the same plan and recalculates the version.

import * as XLSX from 'xlsx';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { dayFromExcelSerial, dayFromYMD, formatDay } from '@/lib/engine/dates';
import { recalcLines } from '@/lib/budget/calc';

// ---- parsing ---------------------------------------------------------------------------------

export interface ReportRow {
  businessUnit: string | null;
  propertyName: string | null;
  unitCode: string;
  bedrooms: string | null;
  area: number | null;
  unitType: string | null;
  unitStatus: string | null;
  leaseNumber: string | null;
  tenantCode: string | null;
  tenantName: string | null;
  customerClass: string | null;
  commencement: string | null;
  start: string | null;
  end: string | null;
  amount: number | null;
  rentPerYear: number | null;
  securityDeposit: number | null;
  maintenanceFee: number | null;
}

const MONTH: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
/** Excel serial, dd-Mon-yyyy, dd/mm/yyyy or ISO → YYYY-MM-DD */
function date(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v > 1000 ? formatDay(dayFromExcelSerial(v)) : null;
  const s = String(v).trim();
  let m = /^(\d{1,2})[-\s/]([A-Za-z]{3})[-\s/](\d{2,4})$/.exec(s);
  if (m && MONTH[m[2].toUpperCase()]) return formatDay(dayFromYMD(+(m[3].length === 2 ? `20${m[3]}` : m[3]), MONTH[m[2].toUpperCase()], +m[1]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return formatDay(dayFromYMD(+m[3], +m[2], +m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/^\d+(\.\d+)?$/.test(s)) return date(Number(s));
  return null;
}
const norm = (h: unknown) => String(h ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

const REQUIRED = ['UNIT NO', 'UNIT STATUS', 'LEASE NUMBER', 'CONTRACT START DATE', 'CONTRACT END DATE', 'ACTUAL LEASE AMOUNT'];

export function parseReport(data: ArrayBuffer | Buffer): ReportRow[] {
  const wb = XLSX.read(data, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  const hi = rows.findIndex((r) => r.some((c) => norm(c) === 'UNIT NO') && r.some((c) => norm(c) === 'LEASE NUMBER'));
  if (hi < 0) throw new Error('This does not look like the Tenant and Lease Details Report (no "Unit No" / "Lease Number" header)');
  const h = rows[hi].map(norm);
  const missing = REQUIRED.filter((n) => !h.includes(n));
  if (missing.length) throw new Error(`Columns missing from the report: ${missing.join(', ')}`);
  const at = (n: string) => h.indexOf(n);
  const c = {
    bu: at('BUSINESS UNIT'), prop: at('PROPERTY NAME'), unit: at('UNIT NO'), bed: at('BEDROOMS'), area: at('BUILTUP AREA'),
    type: at('UNIT TYPE'), status: at('UNIT STATUS'), lease: at('LEASE NUMBER'), tcode: at('TENANT CODE'), tname: at('TENANT FULL NAME'),
    cls: at('CUSTOMER CLASS'), comm: at('LEASE COMMENCEMENT DATE'), start: at('CONTRACT START DATE'), end: at('CONTRACT END DATE'),
    amount: at('ACTUAL LEASE AMOUNT'), rpy: at('RENT PER YEAR'), dep: at('SECURITY DEPOSIT'), mf: at('MAINTENANCE FEE'),
  };
  const get = (r: unknown[], i: number) => (i >= 0 ? r[i] : null);
  return rows
    .slice(hi + 1)
    .filter((r) => str(get(r, c.unit)))
    .map((r) => ({
      businessUnit: str(get(r, c.bu)),
      propertyName: str(get(r, c.prop)),
      unitCode: str(get(r, c.unit))!,
      bedrooms: str(get(r, c.bed)),
      area: num(get(r, c.area)),
      unitType: str(get(r, c.type)),
      unitStatus: str(get(r, c.status)),
      leaseNumber: str(get(r, c.lease)),
      tenantCode: str(get(r, c.tcode)),
      tenantName: str(get(r, c.tname)),
      customerClass: str(get(r, c.cls)),
      commencement: date(get(r, c.comm)),
      start: date(get(r, c.start)),
      end: date(get(r, c.end)),
      amount: num(get(r, c.amount)),
      rentPerYear: num(get(r, c.rpy)),
      securityDeposit: num(get(r, c.dep)),
      maintenanceFee: num(get(r, c.mf)),
    }));
}

// ---- report model: units and leases ------------------------------------------------------------

/**
 * Matching key for a unit code. The property part is compared without its N / P suffix: PMC
 * landlord properties were re-coded in Fusion from …N to …P (50B113N-GF-S4 → 50B113P-GF-S4), and
 * a few budget codes lack the N (10B110-B6.B-06). A trailing note after a space ("… (D)") is ignored;
 * brackets that are part of the code ("MZ(5A)") are kept.
 */
export const unitKey = (code: string) => {
  const c = norm(code).replace(/\s+\([^)]*\)$/, '');
  const i = c.indexOf('-');
  return i < 0 ? c : c.slice(0, i).replace(/[NP]$/, '') + c.slice(i);
};
/** Property part of a unit code, without the N / P suffix: 50B113P-GF-S4 → 50B113 */
export const propertyKey = (codeOrUnit: string) => norm(codeOrUnit).split('-')[0].replace(/[NP]$/, '');

export interface Period {
  start: string;
  end: string;
  amount: number;
}

export interface ReportUnit {
  key: string;
  code: string;
  propertyKey: string;
  propertyPrefix: string;
  propertyName: string | null;
  businessUnit: string | null;
  area: number | null;
  bedrooms: string | null;
  unitType: string | null;
  status: string | null;
  leaseNumbers: string[];
}

export interface ReportLease {
  number: string;
  tenantCode: string | null;
  tenant: string | null;
  customerClass: string | null;
  commencement: string | null;
  businessUnit: string | null;
  units: string[]; // unit keys
  /** whole-lease amount per contract year (a lease on several units repeats its total on each) */
  periods: Period[];
  securityDeposit: number | null;
  maintenanceFee: number | null;
}

/** Same value on every unit → it is the lease total; different values → per-unit amounts to add up. */
function leaseTotal(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  if (!v.length) return null;
  return v.every((x) => Math.abs(x - v[0]) < 0.01) ? v[0] : v.reduce((a, b) => a + b, 0);
}

export function buildModel(rows: ReportRow[]) {
  const units = new Map<string, ReportUnit>();
  const byLease = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const key = unitKey(r.unitCode);
    let u = units.get(key);
    if (!u) {
      const prefix = norm(r.unitCode).split('-')[0];
      u = {
        key, code: r.unitCode.trim(), propertyKey: propertyKey(r.unitCode), propertyPrefix: prefix, propertyName: r.propertyName,
        businessUnit: r.businessUnit, area: r.area, bedrooms: r.bedrooms, unitType: r.unitType, status: r.unitStatus, leaseNumbers: [],
      };
      units.set(key, u);
    }
    if (r.leaseNumber) {
      if (!u.leaseNumbers.includes(r.leaseNumber)) u.leaseNumbers.push(r.leaseNumber);
      byLease.set(r.leaseNumber, [...(byLease.get(r.leaseNumber) ?? []), r]);
    }
  }

  const leases = new Map<string, ReportLease>();
  for (const [number, rs] of byLease) {
    const keys = [...new Set(rs.map((r) => unitKey(r.unitCode)))];
    // contract years: one amount per unit per year
    const years = new Map<string, Map<string, number | null>>();
    for (const r of rs) {
      if (!r.start || !r.end) continue;
      const k = `${r.start}|${r.end}`;
      const m = years.get(k) ?? new Map<string, number | null>();
      m.set(unitKey(r.unitCode), r.amount);
      years.set(k, m);
    }
    const periods: Period[] = [...years]
      .map(([k, m]) => ({ start: k.split('|')[0], end: k.split('|')[1], amount: leaseTotal([...m.values()]) ?? 0 }))
      .sort((a, b) => a.start.localeCompare(b.start));
    const first = rs[0];
    // the first contract year can include months before its contract start (fit-out / early access):
    // when the amount fits the lease commencement better, start the year there
    const firstRow = rs.find((r) => r.start === periods[0]?.start);
    if (periods.length && first.commencement && first.commencement < periods[0].start && firstRow?.rentPerYear) {
      const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000 + 1;
      const perUnitRate = firstRow.rentPerYear;
      const amountPerUnit = firstRow.amount ?? 0;
      const fitContract = Math.abs(amountPerUnit - (perUnitRate * days(periods[0].start, periods[0].end)) / 365);
      const fitCommencement = Math.abs(amountPerUnit - (perUnitRate * days(first.commencement, periods[0].end)) / 365);
      if (fitCommencement < fitContract) periods[0] = { ...periods[0], start: first.commencement };
    }
    const perUnit = (f: (r: ReportRow) => number | null) => leaseTotal(keys.map((k) => f(rs.find((r) => unitKey(r.unitCode) === k)!)));
    leases.set(number, {
      number,
      tenantCode: first.tenantCode,
      tenant: first.tenantName,
      customerClass: first.customerClass,
      commencement: first.commencement,
      businessUnit: first.businessUnit,
      units: keys,
      periods,
      securityDeposit: perUnit((r) => r.securityDeposit),
      maintenanceFee: perUnit((r) => r.maintenanceFee),
    });
  }
  return { units, leases };
}

/**
 * Which contract year is current on the as-of date, and which later years are already contracted.
 * Current: the year running on the as-of date; else, when nothing is running, the last year that
 * ended (renewal pending) if there is one, or the first future year (a lease starting soon).
 */
export function selectContracts<P extends Period>(periods: P[], asOf: string): { current: P | null; following: P[] } {
  const sorted = [...periods].sort((a, b) => a.start.localeCompare(b.start));
  let i = sorted.findIndex((p) => p.start <= asOf && p.end >= asOf);
  if (i < 0) {
    const past = sorted.map((p, j) => [p, j] as const).filter(([p]) => p.end < asOf);
    i = past.length ? past[past.length - 1][1] : sorted.length ? 0 : -1;
  }
  return i < 0 ? { current: null, following: [] } : { current: sorted[i], following: sorted.slice(i + 1) };
}

// ---- plan ----------------------------------------------------------------------------------------

const STOP = new Set(['LLC', 'L.L.C', 'L.L.C.', 'THE', 'AND', 'CO', 'CO.', 'COMPANY', 'BR', 'OF', '&', 'FZE', 'FZCO', 'LTD', 'L', 'C', '(L.L.C)', '(LLC)']);
const tokens = (s: string | null) =>
  new Set(norm(s).replace(/[().,]/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t)));
/** Overlap of two tenant names, 0–1 */
export function nameSimilarity(a: string | null, b: string | null) {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const t of x) if (y.has(t)) common++;
  return common / Math.min(x.size, y.size);
}

const COMMERCIAL = /OFFICE|SHOP|COMMERCIAL|WAREHOUSE|STORE|RESTAURANT|SHOWROOM|PLOT|OPEN SPACE|HOTEL|RETAIL|SCHOOL|GYM|CLINIC/i;
const rcOf = (type: string | null) => (/LABOUR/i.test(type ?? '') ? 'L' : COMMERCIAL.test(type ?? '') ? 'C' : 'R');
const buCodeOf = (name: string | null) => {
  const s = norm(name);
  if (/PMC/.test(s)) return '522';
  if (/- ?MJN$/.test(s)) return '502';
  if (/REAL ESTATE HOLDING/.test(s)) return '501';
  return null;
};

interface Facts {
  leaseNumber: string;
  tenantCode: string | null;
  tenant: string | null;
  customerClass: string | null;
  rentStart: string | null;
  currentStart: string;
  currentEnd: string;
  currentRent: number;
  securityDeposit: number | null;
  leaseRemarks: string | null;
  renewals: Period[]; // contracted later years, up to 3
}

type Assignment = { lease: ReportLease; share: number };

export interface ImportPreview {
  asOf: string;
  report: { rows: number; units: number; available: number; leases: number };
  result: {
    leasedLines: number;
    vacantLines: number;
    currentRent: number;
    contractedLines: number;
    byBu: { bu: string; leases: number; rent: number }[];
  };
  matchedByCode: number;
  matchedByTenant: { lease: string; tenant: string | null; line: string; property: string }[];
  newProperties: { code: string; name: string; bu: string }[];
  newLines: { code: string; property: string; tenant: string | null; rent: number | null; units: number }[];
  notInReport: { code: string; property: string }[];
  skipped: { what: string; detail: string }[];
  conflicts: string[];
}

type Plan = ReturnType<typeof emptyPlan>;
function emptyPlan() {
  return {
    lineFacts: new Map<number, Facts | null>(), // null = no current lease
    unitAttrs: new Map<number, { area?: number | null; unitStatus: string | null; resiCommercial: string | null }>(),
    newProperties: [] as { code: string; name: string; buCode: string; kind: 'BUILDING' | 'CAMP' }[],
    newUnits: [] as {
      propertyCode: string;
      existingUnitId: number | null;
      unit: { unitCode: string; area: number | null; unitType: string | null; bedroom: string | null; rc: string; unitStatus: string | null; resiCommercial: string | null };
      facts: Facts | null;
    }[],
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export async function planImport(versionId: number, rows: ReportRow[], asOf = new Date().toLocaleDateString('en-CA')) {
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version) throw new Error('Version not found');
  if (version.status === 'LOCKED') throw new Error('Version is locked');

  const { units: rUnits, leases } = buildModel(rows);
  const props = await db.select().from(schema.properties);
  const propByKey = new Map(props.map((p) => [propertyKey(p.code), p]));
  const propById = new Map(props.map((p) => [p.id, p]));
  const allUnits = await db.select().from(schema.units);
  const unitById = new Map(allUnits.map((u) => [u.id, u]));
  const unitByKey = new Map(allUnits.map((u) => [unitKey(u.unitCode), u]));
  const lines = await db.select().from(schema.leaseLines).where(eq(schema.leaseLines.versionId, versionId));
  const lineByKey = new Map(lines.map((l) => [unitKey(unitById.get(l.unitId)!.unitCode), l]));
  // tenant on each unit last time (this version, else the imported baseline): to recognise merged-code lines
  const [baseline] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.isBaseline, true));
  const priorTenant = new Map<number, string>();
  if (baseline) for (const l of await db.select().from(schema.leaseLines).where(eq(schema.leaseLines.versionId, baseline.id))) if (l.tenant) priorTenant.set(l.unitId, l.tenant);
  for (const l of lines) if (l.tenant) priorTenant.set(l.unitId, l.tenant);

  const plan = emptyPlan();
  const preview: ImportPreview = {
    asOf,
    report: { rows: rows.length, units: rUnits.size, available: [...rUnits.values()].filter((u) => !u.leaseNumbers.length).length, leases: leases.size },
    result: { leasedLines: 0, vacantLines: 0, currentRent: 0, contractedLines: 0, byBu: [] },
    matchedByCode: 0,
    matchedByTenant: [],
    newProperties: [],
    newLines: [],
    notInReport: [],
    skipped: [],
    conflicts: [],
  };

  // 1. report units → budget lines by unit code
  const lineOfUnit = new Map<string, schema.LeaseLine>();
  for (const u of rUnits.values()) {
    const l = lineByKey.get(u.key);
    if (l) lineOfUnit.set(u.key, l);
  }
  const touched = new Set([...lineOfUnit.values()].map((l) => l.id));

  // 2. leases → lines: through their units; a line can hold several leases (contract years of a new lease)
  const assigned = new Map<number, Assignment[]>();
  const assign = (lineId: number, a: Assignment) => assigned.set(lineId, [...(assigned.get(lineId) ?? []), a]);
  const unplaced: ReportLease[] = [];
  const matchedByLease = new Map<ReportLease, Map<number, number>>(); // lease → line id → area of its report units
  for (const lease of leases.values()) {
    const matched = new Map<number, number>();
    for (const k of lease.units) {
      const l = lineOfUnit.get(k);
      if (l) matched.set(l.id, (matched.get(l.id) ?? 0) + (rUnits.get(k)!.area ?? 0));
    }
    if (matched.size) matchedByLease.set(lease, matched);
    else unplaced.push(lease);
  }
  // a unit in several running leases at once (e.g. a mezzanine shared by neighbouring offices) carries
  // no rent of its own: each lease keeps its rent on its other units
  const lineCode = new Map(lines.map((l) => [l.id, unitById.get(l.unitId)!.unitCode]));
  const runningOnLine = new Map<number, ReportLease[]>();
  for (const [lease, m] of matchedByLease)
    if (lease.periods.some((p) => p.start <= asOf && p.end >= asOf)) for (const id of m.keys()) runningOnLine.set(id, [...(runningOnLine.get(id) ?? []), lease]);
  for (const [id, ls] of runningOnLine) {
    if (ls.length < 2) continue;
    const moved = ls.filter((lease) => matchedByLease.get(lease)!.size > 1);
    for (const lease of moved) matchedByLease.get(lease)!.delete(id);
    if (moved.length) preview.skipped.push({ what: lineCode.get(id)!, detail: `shared by ${ls.length} running leases (${ls.map((l) => l.number).join(', ')}); their rent stays on their other units` });
  }
  for (const [lease, matched] of matchedByLease) {
    preview.matchedByCode++;
    // a lease on several budget lines is spread over them by area (equally when areas are missing)
    const totalArea = [...matched.values()].reduce((a, b) => a + b, 0);
    for (const [lineId, area] of matched) assign(lineId, { lease, share: matched.size === 1 ? 1 : totalArea > 0 ? area / totalArea : 1 / matched.size });
  }

  // 3. leases on none of the budget's unit codes: budget lines held under a merged code (…-Unit-00448)
  // or a group name never appear in the report. Match them within the property by last known tenant.
  const orphansByProp = new Map<number, schema.LeaseLine[]>();
  for (const l of lines) if (!touched.has(l.id)) orphansByProp.set(l.propertyId, [...(orphansByProp.get(l.propertyId) ?? []), l]);
  const unplacedByProp = new Map<string, ReportLease[]>();
  for (const lease of unplaced) {
    const pk = rUnits.get(lease.units[0])!.propertyKey;
    unplacedByProp.set(pk, [...(unplacedByProp.get(pk) ?? []), lease]);
  }
  const stillUnplaced: ReportLease[] = [];
  for (const [pk, ls] of unplacedByProp) {
    const prop = propByKey.get(pk);
    const orphans = prop ? [...(orphansByProp.get(prop.id) ?? [])] : [];
    const total = (l: ReportLease) => selectContracts(l.periods, asOf).current?.amount ?? 0;
    for (const lease of [...ls].sort((a, b) => total(b) - total(a))) {
      let best: schema.LeaseLine | null = null;
      let bestScore = 0;
      for (const o of orphans) {
        const s = nameSimilarity(priorTenant.get(o.unitId) ?? null, lease.tenant);
        if (s > bestScore) [best, bestScore] = [o, s];
      }
      if (!best || bestScore < 0.5) {
        // a single merged-code line and a single lease left in the property belong together
        const merged = orphans.filter((o) => /-UNIT-\d+$/i.test(unitById.get(o.unitId)!.unitCode));
        if (ls.length === 1 && merged.length === 1) best = merged[0];
        else best = null;
      }
      if (!best) {
        stillUnplaced.push(lease);
        continue;
      }
      orphans.splice(orphans.indexOf(best), 1);
      touched.add(best.id);
      assign(best.id, { lease, share: 1 });
      preview.matchedByTenant.push({ lease: lease.number, tenant: lease.tenant, line: unitById.get(best.unitId)!.unitCode, property: prop!.name });
    }
    if (prop) orphansByProp.set(prop.id, orphans);
  }

  // 4. facts per line from its leases' contract years
  const factsFor = (as: Assignment[], label: string): Facts | null => {
    const periods = as.flatMap(({ lease, share }) => lease.periods.map((p) => ({ ...p, amount: r2(p.amount * share), lease, share })));
    const { current, following } = selectContracts(periods, asOf);
    if (!current) return null;
    const running = periods.filter((p) => p.start <= asOf && p.end >= asOf && p.lease !== current.lease);
    if (running.length) preview.conflicts.push(`${label}: ${running.length + 1} leases running at once (${[current, ...running].map((p) => p.lease.number).join(', ')}); using ${current.lease.number}`);
    const lease = current.lease;
    // later years of the same lease (or of a lease signed to follow it); overlapping years are dropped
    const renewals: Period[] = [];
    let end = current.end;
    for (const p of following) {
      if (p.start <= end) continue;
      renewals.push({ start: p.start, end: p.end, amount: p.amount });
      end = p.end;
      if (renewals.length === 3) break;
    }
    const others = lease.units.length;
    return {
      leaseNumber: lease.number,
      tenantCode: lease.tenantCode,
      tenant: lease.tenant,
      customerClass: lease.customerClass,
      rentStart: lease.commencement,
      currentStart: current.start,
      currentEnd: current.end,
      currentRent: current.amount,
      securityDeposit: lease.securityDeposit === null ? null : r2(lease.securityDeposit * current.share),
      leaseRemarks: others > 1 ? `Lease ${lease.number} covers ${others} units${current.share < 1 ? ` (this line: ${Math.round(current.share * 100)}% by area)` : ''}` : null,
      renewals,
    };
  };

  for (const l of lines) {
    const unit = unitById.get(l.unitId)!;
    const as = assigned.get(l.id);
    const facts = as ? factsFor(as, unit.unitCode) : null;
    plan.lineFacts.set(l.id, facts);
    if (!touched.has(l.id)) preview.notInReport.push({ code: unit.unitCode, property: propById.get(l.propertyId)?.name ?? '' });
    // unit attributes from the report (fields the budget keys on — bedroom, unit type, R/C — are left alone)
    const ru = rUnits.get(unitKey(unit.unitCode));
    const leaseArea = (lease: ReportLease) => lease.units.reduce((s, k) => s + (rUnits.get(k)?.area ?? 0), 0);
    if (ru) {
      // a line standing for a whole lease group (a camp held on one of its rooms) takes the group's area
      const whole = as?.length === 1 && as[0].share === 1 && as[0].lease.units.length > 1 ? as[0].lease : null;
      const area = whole ? leaseArea(whole) : ru.area;
      plan.unitAttrs.set(unit.id, { area: area && area > 0 ? area : undefined, unitStatus: ru.status, resiCommercial: ru.unitType });
    } else if (facts) {
      // merged-code line: its area is the lease's units together
      const lease = as![0].lease;
      const area = leaseArea(lease);
      plan.unitAttrs.set(unit.id, { area: unit.area ? undefined : area || undefined, unitStatus: 'Leased', resiCommercial: rUnits.get(lease.units[0])?.unitType ?? null });
    }
  }

  // 5. leases and units not in the budget yet: new lines
  const newPropByKey = new Map<string, { code: string; name: string; buCode: string; kind: 'BUILDING' | 'CAMP' }>();
  const propertyFor = (u: ReportUnit) => {
    const p = propByKey.get(u.propertyKey);
    if (p) return { code: p.code, kind: p.kind };
    let np = newPropByKey.get(u.propertyKey);
    if (!np) {
      const bu = buCodeOf(u.businessUnit);
      if (!bu) return null;
      np = { code: u.propertyPrefix, name: u.propertyName ?? u.propertyPrefix, buCode: bu, kind: /LABOUR/i.test(u.unitType ?? '') ? 'CAMP' : 'BUILDING' };
      newPropByKey.set(u.propertyKey, np);
    }
    return { code: np.code, kind: np.kind };
  };
  const addNew = (u: ReportUnit, facts: Facts | null, units: number, area: number | null) => {
    const p = propertyFor(u);
    if (!p) {
      preview.skipped.push({ what: u.code, detail: `business unit "${u.businessUnit ?? ''}" is not in the budget` });
      return;
    }
    const existing = unitByKey.get(u.key);
    plan.newUnits.push({
      propertyCode: p.code,
      existingUnitId: existing?.id ?? null,
      unit: { unitCode: u.code, area, unitType: u.unitType, bedroom: u.bedrooms, rc: rcOf(u.unitType), unitStatus: u.status, resiCommercial: u.unitType },
      facts,
    });
    preview.newLines.push({ code: u.code, property: u.propertyName ?? p.code, tenant: facts?.tenant ?? null, rent: facts?.currentRent ?? null, units });
  };
  for (const lease of stillUnplaced) {
    const first = rUnits.get([...lease.units].sort()[0])!;
    const facts = factsFor([{ lease, share: 1 }], first.code);
    const area = lease.units.reduce((s, k) => s + (rUnits.get(k)?.area ?? 0), 0);
    if (facts && lease.units.length > 1) facts.leaseRemarks = `Lease ${lease.number} covers ${lease.units.length} units (${Math.round(area).toLocaleString('en-US')} sq ft)`;
    addNew(first, facts, lease.units.length, area || null);
  }
  let campRooms = 0;
  for (const u of rUnits.values()) {
    if (u.leaseNumbers.length || lineOfUnit.has(u.key)) continue;
    // available camp rooms are budgeted as groups the PMs set up (e.g. "CAMP 3 GROUP 1 - 4 rooms"), not room by room
    const p = propByKey.get(u.propertyKey);
    if (p?.kind === 'CAMP' || /LABOUR/i.test(u.unitType ?? '')) {
      campRooms++;
      continue;
    }
    addNew(u, null, 1, u.area);
  }
  if (campRooms) preview.skipped.push({ what: `${campRooms} available camp rooms`, detail: 'not added room by room: budget vacant camp rooms as groups in the Lease Budget' });
  plan.newProperties = [...newPropByKey.values()];
  preview.newProperties = plan.newProperties.map((p) => ({ code: p.code, name: p.name, bu: p.buCode }));

  // 6. totals
  const buOfProp = new Map(props.map((p) => [p.id, p.buCode]));
  const byBu = new Map<string, { leases: number; rent: number }>();
  const count = (bu: string, f: Facts | null) => {
    const e = byBu.get(bu) ?? { leases: 0, rent: 0 };
    if (f) {
      e.leases++;
      e.rent += f.currentRent;
      preview.result.leasedLines++;
      preview.result.currentRent += f.currentRent;
      if (f.renewals.length) preview.result.contractedLines++;
    } else preview.result.vacantLines++;
    byBu.set(bu, e);
  };
  for (const l of lines) count(buOfProp.get(l.propertyId) ?? '?', plan.lineFacts.get(l.id) ?? null);
  for (const n of plan.newUnits) count(propByKey.get(propertyKey(n.propertyCode))?.buCode ?? newPropByKey.get(propertyKey(n.propertyCode))?.buCode ?? '?', n.facts);
  const buNames = new Map((await db.select().from(schema.businessUnits)).map((b) => [b.code, b.name]));
  preview.result.byBu = [...byBu].map(([bu, e]) => ({ bu: `${bu} ${buNames.get(bu) ?? ''}`.trim(), leases: e.leases, rent: Math.round(e.rent) })).sort((a, b) => a.bu.localeCompare(b.bu));
  preview.result.currentRent = Math.round(preview.result.currentRent);
  return { plan, preview };
}

// ---- apply ---------------------------------------------------------------------------------------

const NO_LEASE = {
  leaseNumber: null, leaseVersion: null, tenantCode: null, tenant: null, customerClass: null, rentStart: null, currentStart: null,
  currentEnd: null, currentRent: null, vatAmount: null, securityDeposit: null, leaseStatus: null, leaseRemarks: null,
  currentSchedule: null, vacant: true,
} as const;

function renewalFields(prev: number, facts: Facts | null) {
  const out: Record<string, unknown> = {};
  // drop the contracted years loaded last time; keep anything a PM entered on other renewals
  for (let i = 1; i <= prev; i++) Object.assign(out, { [`r${i}Rent`]: null, [`r${i}Start`]: null, [`r${i}End`]: null, [`r${i}Schedule`]: null });
  if (prev >= 2) out.r2Renew = null;
  if (prev >= 3) out.r3Renew = null;
  const rs = facts?.renewals ?? [];
  rs.forEach((p, j) => {
    const i = j + 1;
    Object.assign(out, { [`r${i}Rent`]: p.amount, [`r${i}Start`]: p.start, [`r${i}End`]: p.end, [`r${i}Schedule`]: null });
    if (i === 1) out.renew1 = true;
    else out[`r${i}Renew`] = true;
  });
  out.contracted = rs.length;
  return out;
}

function factFields(line: Pick<schema.LeaseLine, 'leaseNumber' | 'currentStart' | 'currentSchedule' | 'staffOwner'> | null, f: Facts, now: Date) {
  return {
    leaseNumber: f.leaseNumber,
    leaseVersion: null,
    tenantCode: f.tenantCode,
    tenant: f.tenant,
    customerClass: f.customerClass,
    rentStart: f.rentStart,
    currentStart: f.currentStart,
    currentEnd: f.currentEnd,
    currentRent: f.currentRent,
    vatAmount: null,
    securityDeposit: f.securityDeposit,
    leaseStatus: 'Leased',
    leaseRemarks: f.leaseRemarks,
    // a cheque schedule entered for this same contract stays
    currentSchedule: line && line.leaseNumber === f.leaseNumber && line.currentStart === f.currentStart ? line.currentSchedule : null,
    vacant: false,
    leaseSyncedAt: now,
    ...(line?.staffOwner || !/STAFF/i.test(f.customerClass ?? '') ? {} : { staffOwner: 'STAFF' }),
  };
}

export async function applyImport(versionId: number, rows: ReportRow[], userId: number | null, fileName?: string) {
  const { plan, preview } = await planImport(versionId, rows);
  const now = new Date();
  const lines = await db.select().from(schema.leaseLines).where(eq(schema.leaseLines.versionId, versionId));
  const lineById = new Map(lines.map((l) => [l.id, l]));

  await db.transaction(async (tx) => {
    for (const p of plan.newProperties) await tx.insert(schema.properties).values(p).onConflictDoNothing();
    const props = await tx.select().from(schema.properties);
    const propByKey = new Map(props.map((p) => [propertyKey(p.code), p]));

    for (const [lineId, facts] of plan.lineFacts) {
      const line = lineById.get(lineId)!;
      const set = facts ? { ...factFields(line, facts, now), ...renewalFields(line.contracted, facts) } : { ...NO_LEASE, leaseSyncedAt: now, ...renewalFields(line.contracted, null) };
      await tx.update(schema.leaseLines).set(set).where(eq(schema.leaseLines.id, lineId));
    }
    for (const [unitId, a] of plan.unitAttrs) {
      await tx.update(schema.units).set({ unitStatus: a.unitStatus, resiCommercial: a.resiCommercial, ...(a.area !== undefined ? { area: a.area } : {}) }).where(eq(schema.units.id, unitId));
    }
    for (const n of plan.newUnits) {
      const prop = propByKey.get(propertyKey(n.propertyCode))!;
      let unitId = n.existingUnitId;
      if (!unitId) [{ id: unitId }] = await tx.insert(schema.units).values({ propertyId: prop.id, ...n.unit }).returning({ id: schema.units.id });
      const base = { versionId, unitId, propertyId: prop.id, renew1: true };
      const values = n.facts ? { ...base, ...factFields(null, n.facts, now), ...renewalFields(0, n.facts) } : { ...base, ...NO_LEASE, leaseSyncedAt: now };
      await tx.insert(schema.leaseLines).values(values).onConflictDoNothing();
    }

    await tx.insert(schema.auditLog).values({
      userId,
      versionId,
      entity: 'lease_import',
      action: 'tenant_lease_details',
      changes: {
        file: fileName ?? null,
        asOf: preview.asOf,
        report: preview.report,
        result: { ...preview.result, byBu: undefined },
        matchedByTenant: preview.matchedByTenant.length,
        newLines: preview.newLines.length,
        newProperties: preview.newProperties.map((p) => p.code),
        notInReport: preview.notInReport.length,
      },
    });
    await recalcLines(tx, versionId);
  });

  // new lines need a submission row in this version
  await db.execute(sql`
    insert into submissions (version_id, property_id, status)
    select distinct ${versionId}::int, property_id, 'DRAFT'::submission_status from lease_lines where version_id = ${versionId}
    on conflict do nothing`);
  return preview;
}
