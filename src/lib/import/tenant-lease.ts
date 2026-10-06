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
  utilityFee: number | null;
  carParkFee: number | null;
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
    util: at('UTILITY FEE'), park: at('ADDITIONAL CAR PARK'),
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
      utilityFee: num(get(r, c.util)),
      carParkFee: num(get(r, c.park)),
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

/** Charges billed with the lease besides rent: other income, kept out of rent revenue. */
export interface Fees {
  maintenance: number;
  utility: number;
  carPark: number;
}

export interface Period {
  start: string;
  end: string;
  amount: number;
  /** other income for the same contract year */
  fees?: Fees;
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
    // contract years: one row per unit per year
    const years = new Map<string, Map<string, ReportRow>>();
    for (const r of rs) {
      if (!r.start || !r.end) continue;
      const k = `${r.start}|${r.end}`;
      const m = years.get(k) ?? new Map<string, ReportRow>();
      m.set(unitKey(r.unitCode), r);
      years.set(k, m);
    }
    const periods: Period[] = [...years]
      .map(([k, m]) => {
        const yr = [...m.values()];
        const total = (f: (r: ReportRow) => number | null) => leaseTotal(yr.map(f)) ?? 0;
        return {
          start: k.split('|')[0],
          end: k.split('|')[1],
          amount: total((r) => r.amount),
          fees: { maintenance: total((r) => r.maintenanceFee), utility: total((r) => r.utilityFee), carPark: total((r) => r.carParkFee) },
        };
      })
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

// ---- plan: the version's lines, rebuilt from the report ------------------------------------------
//
// One line per letting unit: a lease on several units (camps, whole buildings, merged units) is one
// line, held on one of its unit codes; an available unit is a line of its own. Nothing is taken from
// a previous budget: unit details are derived from the report and left blank when it has no value.
// Budget inputs a PM entered on a line (outcome, rates, overrides, notes …) carry over when the
// line's unit is still in the report.

export type Family = 'Residential' | 'Commercial' | 'Retail' | 'Warehouse' | 'Camps';

/** Reporting family of an Oracle unit type. */
export function familyOf(type: string | null): Family {
  const t = norm(type);
  if (/LABOUR/.test(t)) return 'Camps';
  if (/SHOP|SHOWROOM|RESTAURANT|STORE|RETAIL|KIOSK|CAFE/.test(t)) return 'Retail';
  if (/WAREHOUSE|SHED|PLOT|LAND|YARD/.test(t)) return 'Warehouse';
  if (/APARTMENT|VILLA|STUDIO|BED ROOM|RESIDENTIAL|PENTHOUSE|ROOM$/.test(t)) return 'Residential';
  return 'Commercial';
}
/** R residential (no VAT) · C commercial · L labour accommodation */
export const rcOf = (type: string | null) => ({ Residential: 'R', Camps: 'L' } as Record<Family, string>)[familyOf(type)] ?? 'C';
/** RERA index key from the Oracle unit type: STUDIO, 1BR, 3BR VILLA, OFFICE, SHOP … */
export function bedroomCode(type: string | null): string | null {
  const t = norm(type);
  if (!t) return null;
  if (/STUDIO/.test(t)) return 'STUDIO';
  const m = /(\d+)\s*BED\s*ROOM/.exec(t);
  if (m) return `${m[1]}BR${/VILLA/.test(t) ? ' VILLA' : ''}`;
  return t;
}

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
  /** other income on the current contract year */
  fees: Fees;
}

export interface ImportPreview {
  asOf: string;
  report: { rows: number; units: number; available: number; leases: number };
  result: {
    lines: number;
    leasedLines: number;
    vacantLines: number;
    multiUnitLines: number;
    currentRent: number;
    contractedLines: number;
    byBu: { bu: string; leases: number; rent: number }[];
  };
  /** lines whose unit already had a line: budget inputs kept */
  kept: number;
  newLines: { code: string; property: string; tenant: string | null; rent: number | null; units: number }[];
  removedLines: { code: string; property: string; tenant: string | null; inputs: boolean }[];
  newProperties: { code: string; name: string; bu: string }[];
  skipped: { what: string; detail: string }[];
  conflicts: string[];
}

interface PlannedLine {
  unit: ReportUnit; // the unit code the line is held on
  members: ReportUnit[];
  propertyKey: string;
  attrs: { area: number | null; unitType: string | null; resiCommercial: string | null; rc: string; pivotCategory: Family; bedroom: string | null; rooms: number | null; unitStatus: string | null };
  facts: Facts | null;
  carryFrom: schema.LeaseLine | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Current contract and contracted later years of a line from its leases. */
function factsFor(leaseList: ReportLease[], asOf: string, label: string, conflicts: string[]): Facts | null {
  const periods = leaseList.flatMap((lease) => lease.periods.map((p) => ({ ...p, lease })));
  const { current, following } = selectContracts(periods, asOf);
  if (!current) return null;
  const running = periods.filter((p) => p.start <= asOf && p.end >= asOf && p.lease !== current.lease);
  if (running.length) conflicts.push(`${label}: ${running.length + 1} leases running at once (${[current, ...running].map((p) => p.lease.number).join(', ')}); using ${current.lease.number}`);
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
  return {
    leaseNumber: lease.number,
    tenantCode: lease.tenantCode,
    tenant: lease.tenant,
    customerClass: lease.customerClass,
    rentStart: lease.commencement,
    currentStart: current.start,
    currentEnd: current.end,
    currentRent: r2(current.amount),
    securityDeposit: lease.securityDeposit,
    fees: { maintenance: r2(current.fees?.maintenance ?? 0), utility: r2(current.fees?.utility ?? 0), carPark: r2(current.fees?.carPark ?? 0) },
    leaseRemarks: null,
    renewals,
  };
}

/** Which of a unit's leases holds it: the one running today, else the next to start, else the last to end. */
function leaseRank(lease: ReportLease, asOf: string): [number, number] {
  const { current } = selectContracts(lease.periods, asOf);
  if (!current) return [3, 0];
  if (current.start <= asOf && current.end >= asOf) return [0, -current.amount];
  if (current.start > asOf) return [1, Date.parse(current.start)];
  return [2, -Date.parse(current.end)];
}

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
  const lines = await db.select().from(schema.leaseLines).where(eq(schema.leaseLines.versionId, versionId));
  const lineByKey = new Map(lines.map((l) => [unitKey(unitById.get(l.unitId)!.unitCode), l]));

  const conflicts: string[] = [];
  const skipped: ImportPreview['skipped'] = [];

  // 1. each unit belongs to one lease (or none): group units by that lease
  const groups = new Map<string, { units: ReportUnit[]; leases: ReportLease[] }>();
  const groupOfLease = new Map<string, string>();
  for (const u of rUnits.values()) {
    const ls = u.leaseNumbers.map((n) => leases.get(n)!).filter((l) => l.periods.length);
    let key = `U:${u.key}`;
    if (ls.length) {
      const best = ls.map((l) => [l, leaseRank(l, asOf)] as const).sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1])[0][0];
      key = `L:${best.number}`;
      groupOfLease.set(best.number, key);
    }
    const g = groups.get(key) ?? { units: [], leases: [] };
    g.units.push(u);
    groups.set(key, g);
  }
  for (const [n, key] of groupOfLease) groups.get(key)!.leases.push(leases.get(n)!);
  // a lease no unit is held on (e.g. a renewal signed in advance) follows its units' line
  for (const lease of leases.values()) {
    if (groupOfLease.has(lease.number)) continue;
    const u = rUnits.get(lease.units[0]);
    const key = u && [...groups].find(([, g]) => g.units.includes(u))?.[0];
    if (key) groups.get(key)!.leases.push(lease);
  }

  // 2. one planned line per group
  const planned: PlannedLine[] = [];
  for (const g of groups.values()) {
    const members = [...g.units].sort((a, b) => a.code.localeCompare(b.code));
    // hold the line on a unit code that already has a line (keeps its budget inputs), else the first code
    const held = members.find((m) => lineByKey.has(m.key)) ?? members[0];
    const carryFrom = lineByKey.get(held.key) ?? members.map((m) => lineByKey.get(m.key)).find(Boolean) ?? null;
    // the line's unit type: the type with the most area in the group
    const typeArea = new Map<string, number>();
    for (const m of members) typeArea.set(m.unitType ?? '', (typeArea.get(m.unitType ?? '') ?? 0) + (m.area ?? 0) + 1e-6);
    const type = [...typeArea].sort((a, b) => b[1] - a[1])[0][0] || null;
    const areas = members.map((m) => m.area).filter((a): a is number => a !== null && a > 0);
    const facts = g.leases.length ? factsFor(g.leases, asOf, held.code, conflicts) : null;
    if (facts && members.length > 1) {
      facts.leaseRemarks = `Lease ${facts.leaseNumber} covers ${members.length} units: ${members.slice(0, 12).map((m) => m.code).join(', ')}${members.length > 12 ? ', …' : ''}`;
    }
    planned.push({
      unit: held,
      members,
      propertyKey: held.propertyKey,
      attrs: {
        area: areas.length ? r2(areas.reduce((a, b) => a + b, 0)) : null,
        unitType: type,
        resiCommercial: type,
        rc: rcOf(type),
        pivotCategory: familyOf(type),
        bedroom: bedroomCode(type),
        rooms: familyOf(type) === 'Camps' ? members.length : null,
        unitStatus: facts ? 'Leased' : (held.status ?? 'Available'),
      },
      facts,
      carryFrom,
    });
  }

  // 3. properties: new ones from the report (BU from the report's business unit)
  const newProps = new Map<string, { code: string; name: string; buCode: string; kind: 'BUILDING' | 'CAMP' }>();
  const keep: PlannedLine[] = [];
  for (const p of planned) {
    if (propByKey.has(p.propertyKey)) {
      keep.push(p);
      continue;
    }
    if (!newProps.has(p.propertyKey)) {
      const bu = buCodeOf(p.unit.businessUnit);
      if (!bu) {
        skipped.push({ what: p.unit.code, detail: `business unit "${p.unit.businessUnit ?? ''}" is not in the budget` });
        continue;
      }
      newProps.set(p.propertyKey, { code: p.unit.propertyPrefix, name: p.unit.propertyName ?? p.unit.propertyPrefix, buCode: bu, kind: p.attrs.pivotCategory === 'Camps' ? 'CAMP' : 'BUILDING' });
    }
    keep.push(p);
  }

  // 4. preview
  const carried = new Set(keep.map((p) => p.carryFrom?.id).filter(Boolean));
  const hasInputs = (l: schema.LeaseLine) => l.budgetRate !== null || l.notes !== null || l.staffOwner !== null || l.increasePctOverride !== null || l.noRenewal || !l.renew1;
  const buNames = new Map((await db.select().from(schema.businessUnits)).map((b) => [b.code, b.name]));
  const buOf = (p: PlannedLine) => propByKey.get(p.propertyKey)?.buCode ?? newProps.get(p.propertyKey)?.buCode ?? '?';
  const byBu = new Map<string, { leases: number; rent: number }>();
  for (const p of keep) {
    const e = byBu.get(buOf(p)) ?? { leases: 0, rent: 0 };
    if (p.facts) {
      e.leases++;
      e.rent += p.facts.currentRent;
    }
    byBu.set(buOf(p), e);
  }
  const leased = keep.filter((p) => p.facts);
  const preview: ImportPreview = {
    asOf,
    report: { rows: rows.length, units: rUnits.size, available: [...rUnits.values()].filter((u) => !u.leaseNumbers.length).length, leases: leases.size },
    result: {
      lines: keep.length,
      leasedLines: leased.length,
      vacantLines: keep.length - leased.length,
      multiUnitLines: keep.filter((p) => p.members.length > 1).length,
      currentRent: Math.round(leased.reduce((s, p) => s + p.facts!.currentRent, 0)),
      contractedLines: leased.filter((p) => p.facts!.renewals.length).length,
      byBu: [...byBu].map(([bu, e]) => ({ bu: `${bu} ${buNames.get(bu) ?? ''}`.trim(), leases: e.leases, rent: Math.round(e.rent) })).sort((a, b) => a.bu.localeCompare(b.bu)),
    },
    kept: keep.filter((p) => p.carryFrom && lineByKey.get(p.unit.key) === p.carryFrom).length,
    newLines: keep
      .filter((p) => !p.carryFrom)
      .map((p) => ({ code: p.unit.code, property: p.unit.propertyName ?? '', tenant: p.facts?.tenant ?? null, rent: p.facts?.currentRent ?? null, units: p.members.length })),
    removedLines: lines
      .filter((l) => !carried.has(l.id))
      .map((l) => ({ code: unitById.get(l.unitId)!.unitCode, property: propById.get(l.propertyId)?.name ?? '', tenant: l.tenant, inputs: hasInputs(l) })),
    newProperties: [...newProps.values()].map((p) => ({ code: p.code, name: p.name, bu: p.buCode })),
    skipped,
    conflicts,
  };
  return { plan: { lines: keep, newProperties: [...newProps.values()] }, preview };
}

// ---- apply ---------------------------------------------------------------------------------------

const NO_LEASE = {
  leaseNumber: null, leaseVersion: null, tenantCode: null, tenant: null, customerClass: null, rentStart: null, currentStart: null,
  currentEnd: null, currentRent: null, vatAmount: null, securityDeposit: null, leaseStatus: null, leaseRemarks: null,
  maintenanceFee: null, utilityFee: null, carParkFee: null,
  currentSchedule: null, vacant: true,
} as const;

/** Budget inputs a PM may have entered on a line; they follow the unit into the rebuilt line. */
const INPUT_FIELDS = [
  'staffOwner', 'mfCurrent', 'renew1', 'noRenewal', 'budgetRate', 'increasePctOverride', 'cheques', 'notes',
  'r1Rent', 'r1Start', 'r1End', 'r1Mf', 'r1Schedule', 'r2Renew', 'r2Rent', 'r2Start', 'r2End', 'r2Mf', 'r2Schedule',
  'r3Renew', 'r3Rent', 'r3Start', 'r3End', 'r3Mf', 'r3Schedule',
] as const;

function carriedInputs(l: schema.LeaseLine | null) {
  if (!l) return {};
  const out: Record<string, unknown> = {};
  for (const k of INPUT_FIELDS) out[k] = l[k];
  // contracted years loaded by the last import are not inputs: drop them (renewalFields refills)
  for (let i = 1; i <= l.contracted; i++) Object.assign(out, { [`r${i}Rent`]: null, [`r${i}Start`]: null, [`r${i}End`]: null, [`r${i}Schedule`]: null });
  if (l.contracted >= 2) out.r2Renew = null;
  if (l.contracted >= 3) out.r3Renew = null;
  return out;
}

function renewalFields(facts: Facts | null) {
  const out: Record<string, unknown> = {};
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
    maintenanceFee: f.fees.maintenance || null,
    utilityFee: f.fees.utility || null,
    carParkFee: f.fees.carPark || null,
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

  await db.transaction(async (tx) => {
    for (const p of plan.newProperties) await tx.insert(schema.properties).values(p).onConflictDoNothing();
    const props = await tx.select().from(schema.properties);
    const propByKey = new Map(props.map((p) => [propertyKey(p.code), p]));
    const unitByKey = new Map((await tx.select().from(schema.units)).map((u) => [unitKey(u.unitCode), u]));

    // the version's lines are rebuilt from the report
    await tx.delete(schema.leaseLines).where(eq(schema.leaseLines.versionId, versionId));
    for (const p of plan.lines) {
      const prop = propByKey.get(p.propertyKey)!;
      // unit details come from the report only; beds (capacity) have no source there and stay as entered
      const attrs = { ...p.attrs, propertyId: prop.id, mergedUnitNumber: null, landlord: null };
      let unit = unitByKey.get(p.unit.key);
      if (unit) await tx.update(schema.units).set(attrs).where(eq(schema.units.id, unit.id));
      else [unit] = await tx.insert(schema.units).values({ unitCode: p.unit.code, ...attrs }).returning();
      const old = p.carryFrom;
      await tx.insert(schema.leaseLines).values({
        versionId,
        unitId: unit.id,
        propertyId: prop.id,
        renew1: true,
        ...carriedInputs(old),
        ...(p.facts ? factFields(old, p.facts, now) : { ...NO_LEASE, leaseSyncedAt: now }),
        ...renewalFields(p.facts),
        updatedBy: userId,
      });
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
        kept: preview.kept,
        newLines: preview.newLines.length,
        removedLines: preview.removedLines.map((r) => r.code),
        newProperties: preview.newProperties.map((p) => p.code),
      },
    });
    await recalcLines(tx, versionId);
  });

  // every property with lines needs a submission row in this version
  await db.execute(sql`
    insert into submissions (version_id, property_id, status)
    select distinct ${versionId}::int, property_id, 'DRAFT'::submission_status from lease_lines where version_id = ${versionId}
    on conflict do nothing`);
  return preview;
}
