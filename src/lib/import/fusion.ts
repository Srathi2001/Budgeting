// Oracle Fusion lease & unit data.
//
// Today: the "Lease Status Summary Report" and the Unit Dump exported from Fusion as Excel.
// Later: the same records from the Fusion BI Publisher / REST API. Everything downstream of the
// parsers (applyFusionLeases / applyUnitDump) stays the same.

import * as XLSX from 'xlsx';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { dayFromExcelSerial, dayFromYMD, formatDay } from '@/lib/engine/dates';
import { recalcLines } from '@/lib/budget/calc';

export interface FusionLease {
  businessUnit: string | null;
  leaseNumber: string | null;
  unitCode: string;
  unitType: string | null;
  grossArea: number | null;
  propertyCode: string | null;
  propertyName: string | null;
  leaseVersion: string | null;
  tenantCode: string | null;
  tenantName: string | null;
  customerClass: string | null;
  leaseStart: string | null;
  rentStart: string | null;
  leaseEnd: string | null;
  actualLeaseAmount: number | null;
  taxAmount: number | null;
  rentPerAnnum: number | null;
  securityDeposit: number | null;
  leaseStatus: string | null;
  leaseRemarks: string | null;
}

export interface FusionUnit {
  unitCode: string;
  bu: string | null;
  landlord: string | null;
  propertyName: string | null;
  unitStatus: string | null;
  leaseNumber: string | null;
  mergedUnitNumber: string | null;
  unitUsage: string | null;
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
  return null;
}

const norm = (h: unknown) => String(h ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

/** Parse the Fusion "Lease Status Summary Report" export (first sheet). */
export function parseLeaseReport(data: ArrayBuffer | Buffer): FusionLease[] {
  const wb = XLSX.read(data, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  const hi = rows.findIndex((r) => r.some((c) => norm(c) === 'LEASE NUMBER') && r.some((c) => norm(c) === 'UNIT CODE'));
  if (hi < 0) throw new Error('This does not look like the Lease Status Summary Report (no "Lease Number" / "Unit Code" header)');
  const h = rows[hi].map(norm);
  const col = (name: string) => h.indexOf(name);
  const c = {
    bu: col('BUSINESS UNIT'),
    lease: col('LEASE NUMBER'),
    unit: col('UNIT CODE'),
    type: col('UNIT TYPE'),
    area: col('GROSS AREA'),
    pcode: col('PROPERTY CODE'),
    pname: col('PROPERTY NAME'),
    ver: col('LEASE VERSION'),
    tcode: col('TENANT CODE'),
    tname: col('TENANT NAME'),
    cls: col('CUSTOMER CLASS'),
    start: col('LEASE START'),
    rentStart: col('RENT START'),
    end: col('LEASE END'),
    amount: col('ACTUAL LEASE AMOUNT'),
    tax: col('TAX AMOUNT'),
    rpa: col('RENT PER ANNUM'),
    dep: col('SECURITY DEPOSIT'),
    status: col('LEASE STATUS'),
    remarks: col('LEASE REMARKS'),
  };
  const get = (r: unknown[], i: number) => (i >= 0 ? r[i] : null);
  return rows
    .slice(hi + 1)
    .filter((r) => str(get(r, c.unit)))
    .map((r) => ({
      businessUnit: str(get(r, c.bu)),
      leaseNumber: str(get(r, c.lease)),
      unitCode: str(get(r, c.unit))!,
      unitType: str(get(r, c.type)),
      grossArea: num(get(r, c.area)),
      propertyCode: str(get(r, c.pcode)),
      propertyName: str(get(r, c.pname)),
      leaseVersion: str(get(r, c.ver)),
      tenantCode: str(get(r, c.tcode)),
      tenantName: str(get(r, c.tname)),
      customerClass: str(get(r, c.cls)),
      leaseStart: date(get(r, c.start)),
      rentStart: date(get(r, c.rentStart)),
      leaseEnd: date(get(r, c.end)),
      actualLeaseAmount: num(get(r, c.amount)),
      taxAmount: num(get(r, c.tax)),
      rentPerAnnum: num(get(r, c.rpa)),
      securityDeposit: num(get(r, c.dep)),
      leaseStatus: str(get(r, c.status)),
      leaseRemarks: str(get(r, c.remarks)),
    }));
}

const STATUS = /^(LEASED|AVAILABLE|PENDING|VACANT|BLOCKED|RESERVED|UNDER\s.*|OCCUPIED|INACTIVE)$/i;
const USAGE = /^(RESIDENTIAL|COMMERCIAL|RETAIL|INDUSTRIAL|WAREHOUSE|LABOUR|CAMP|MIXED.*)$/i;

/** Parse the Fusion Unit Dump (one sheet per BU; columns located by header, values checked by pattern). */
export function parseUnitDump(data: ArrayBuffer | Buffer): FusionUnit[] {
  const wb = XLSX.read(data, { type: 'buffer' });
  const out: FusionUnit[] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null });
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === 'UNIT CODE'));
    if (hi < 0) continue;
    const h = rows[hi].map(norm);
    const at = (n: string) => h.indexOf(n);
    for (const r of rows.slice(hi + 1)) {
      const unitCode = str(r[at('UNIT CODE')]);
      if (!unitCode) continue;
      const cells = r.map(str);
      // some exports shift columns: fall back to recognising the value itself
      const pick = (i: number, re: RegExp) => {
        const v = i >= 0 ? cells[i] : null;
        return v && re.test(v) ? v : (cells.find((x) => x && re.test(x)) ?? null);
      };
      out.push({
        unitCode,
        bu: str(r[at('BU')]),
        landlord: at('LANDLORD') >= 0 ? str(r[at('LANDLORD')]) : null,
        propertyName: str(r[at('PROPERTY NAME')]),
        unitStatus: pick(at('UNIT STATUS'), STATUS),
        leaseNumber: pick(at('LEASE NUMBER'), /\/LES\/|^\d{3,6}$|^[A-Z]{2,4}\d+$/),
        mergedUnitNumber: pick(at('MERGED UNIT NUMBER'), /-Unit-\d+/i),
        unitUsage: pick(at('UNIT USAGE'), USAGE),
      });
    }
  }
  return out;
}

// PMC landlord properties were re-coded in Fusion from …N to …P (50B113N → 50B113P); the old lease
// is left Suspended and the renewal sits on the P code. Both name the same property and unit.
const normProp = (c: string) => c.trim().toUpperCase().replace(/[NP]$/, '');
const normUnit = (c: string) => c.trim().toUpperCase();
const nTwin = (unitCode: string) => normUnit(unitCode).replace(/^([0-9A-Z]+?)P-/, '$1N-');

/**
 * The report can include each unit's lease history (Terminated, Pre-Terminated, Suspended).
 * Keep one Approved lease per unit. An Approved lease past its end date is kept: the renewal is
 * still pending, and the budget derives it. With several Approved leases (a renewal signed in
 * advance), the one running on the as-of date wins, else the next to start, else the last to end.
 */
export function currentLeases(leases: FusionLease[], asOf: string = new Date().toLocaleDateString('en-CA')) {
  const approved = new Map<string, FusionLease[]>();
  const skipped: Record<string, number> = {};
  const skip = (k: string) => (skipped[k] = (skipped[k] ?? 0) + 1);
  for (const l of leases) {
    const status = (l.leaseStatus ?? '').trim();
    if (!/^approved$/i.test(status)) {
      skip(status || '(blank)');
      continue;
    }
    const k = normUnit(l.unitCode);
    approved.set(k, [...(approved.get(k) ?? []), l]);
  }
  const rank = (l: FusionLease) => {
    const start = l.leaseStart ?? '', end = l.leaseEnd ?? '9999';
    if (start <= asOf && end >= asOf) return `0${start}`; // running
    if (start > asOf) return `1${start}`; // signed, starts later: earliest first
    return `2${String(99999999 - Number(end.replace(/-/g, '')))}`; // ended: latest end first
  };
  const out: FusionLease[] = [];
  for (const ls of approved.values()) {
    ls.sort((a, b) => rank(a).localeCompare(rank(b)));
    out.push(ls[0]);
    for (let i = 1; i < ls.length; i++) skip('Approved, superseded');
  }
  return { leases: out, skipped };
}

export interface FusionSyncResult {
  /** report rows not used, by lease status */
  skipped: Record<string, number>;
  matched: number;
  /** leases on a merged unit, spread over its member units */
  mergedLeases: number;
  createdUnits: string[];
  unknownProperties: string[];
  cleared: number;
}

/**
 * Load current leases into a budget version. The report is treated as a full snapshot for the
 * business units it contains: units of those BUs that have no lease in it lose their lease details.
 */
export async function applyFusionLeases(versionId: number, reportRows: FusionLease[], userId: number | null): Promise<FusionSyncResult> {
  const { leases, skipped } = currentLeases(reportRows);
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version) throw new Error('Version not found');
  if (version.status === 'LOCKED') throw new Error('Version is locked');

  const props = await db.select().from(schema.properties);
  const propByCode = new Map(props.map((p) => [normProp(p.code), p]));
  const unitsAll = await db.select().from(schema.units);
  const unitByCode = new Map(unitsAll.map((u) => [normUnit(u.unitCode), u]));
  // Fusion leases a merged unit under the merged unit's code; the budget keeps its member units
  const membersByMerged = new Map<string, schema.Unit[]>();
  for (const u of unitsAll) {
    if (!u.mergedUnitNumber) continue;
    const k = normUnit(u.mergedUnitNumber);
    membersByMerged.set(k, [...(membersByMerged.get(k) ?? []), u]);
  }
  const lines = await db.select().from(schema.leaseLines).where(eq(schema.leaseLines.versionId, versionId));
  const lineByUnit = new Map(lines.map((l) => [l.unitId, l]));
  const now = new Date();
  const result: FusionSyncResult = { skipped, matched: 0, mergedLeases: 0, createdUnits: [], unknownProperties: [], cleared: 0 };
  const touchedLines = new Set<number>();
  // BUs come from all report rows: a BU whose leases have all ended still counts as reported
  const buNames = new Set(reportRows.map((l) => l.businessUnit?.toUpperCase()).filter(Boolean) as string[]);

  await db.transaction(async (tx) => {
    for (const f of leases) {
      // 1. the unit itself (or its N-coded twin), 2. the member units of a merged unit, 3. a new unit in a known property
      let targets: schema.Unit[] = [];
      const direct = unitByCode.get(normUnit(f.unitCode)) ?? unitByCode.get(nTwin(f.unitCode));
      if (direct) targets = [direct];
      else {
        const members = membersByMerged.get(normUnit(f.unitCode)) ?? membersByMerged.get(nTwin(f.unitCode));
        if (members?.length) {
          targets = members;
          result.mergedLeases++;
        } else {
          const prop = f.propertyCode ? propByCode.get(normProp(f.propertyCode)) : undefined;
          if (!prop) {
            result.unknownProperties.push(`${f.propertyCode ?? '?'} (${f.unitCode})`);
            continue;
          }
          const [unit] = await tx
            .insert(schema.units)
            .values({
              propertyId: prop.id,
              unitCode: f.unitCode.trim(),
              area: f.grossArea,
              // VAT is only charged on commercial rent
              rc: (f.taxAmount ?? 0) > 0 ? 'C' : 'R',
              unitType: f.unitType,
            })
            .returning();
          unitByCode.set(normUnit(unit.unitCode), unit);
          result.createdUnits.push(unit.unitCode);
          targets = [unit];
        }
      }

      // amounts of a merged lease are spread over its units by area (equally when areas are missing)
      const areas = targets.map((u) => u.area ?? 0);
      const totalArea = areas.reduce((a, b) => a + b, 0);
      const share = (i: number) => (targets.length === 1 ? 1 : totalArea > 0 ? areas[i] / totalArea : 1 / targets.length);
      const part = (v: number | null, i: number) => (v === null ? null : Math.round(v * share(i) * 100) / 100);
      const rent = f.actualLeaseAmount ?? f.rentPerAnnum;
      const staff = /STAFF/i.test(f.leaseRemarks ?? '');

      for (const [i, unit] of targets.entries()) {
        const facts = {
          leaseNumber: f.leaseNumber,
          leaseVersion: f.leaseVersion,
          tenantCode: f.tenantCode,
          tenant: f.tenantName,
          customerClass: f.customerClass,
          currentStart: f.leaseStart,
          rentStart: f.rentStart,
          currentEnd: f.leaseEnd,
          currentRent: part(rent, i),
          vatAmount: part(f.taxAmount, i),
          securityDeposit: part(f.securityDeposit, i),
          leaseStatus: f.leaseStatus,
          leaseRemarks: targets.length > 1 ? `Merged lease ${f.unitCode} (${targets.length} units). ${f.leaseRemarks ?? ''}`.trim() : f.leaseRemarks,
          vacant: false,
          leaseSyncedAt: now,
        };
        let line = lineByUnit.get(unit.id);
        if (line) {
          const patch: Record<string, unknown> = { ...facts };
          // staff leases are flagged in the remarks ("20% STAFF DISCOUNT …")
          if (!line.staffOwner && staff) patch.staffOwner = 'STAFF';
          await tx.update(schema.leaseLines).set(patch).where(eq(schema.leaseLines.id, line.id));
        } else {
          [line] = await tx
            .insert(schema.leaseLines)
            .values({ versionId, unitId: unit.id, propertyId: unit.propertyId, renew1: true, ...facts, staffOwner: staff ? 'STAFF' : null })
            .returning();
          lineByUnit.set(unit.id, line);
        }
        touchedLines.add(line.id);
      }
      result.matched++;
    }

    // units of the reported BUs without a lease in the snapshot: no current lease
    const buByProp = new Map(props.map((p) => [p.id, p.buCode]));
    const bus = await tx.select().from(schema.businessUnits);
    const reportedBuCodes = new Set(bus.filter((b) => buNames.has(b.name.toUpperCase()) || buNames.has(b.code)).map((b) => b.code));
    const toClear = lines.filter((l) => !touchedLines.has(l.id) && reportedBuCodes.has(buByProp.get(l.propertyId) ?? '') && l.currentEnd);
    if (toClear.length) {
      await tx
        .update(schema.leaseLines)
        .set({
          leaseNumber: null, leaseVersion: null, tenantCode: null, tenant: null, customerClass: null,
          currentStart: null, rentStart: null, currentEnd: null, currentRent: null, vatAmount: null,
          securityDeposit: null, leaseStatus: null, leaseRemarks: null, currentSchedule: null, vacant: true, leaseSyncedAt: now,
        })
        .where(inArray(schema.leaseLines.id, toClear.map((l) => l.id)));
      result.cleared = toClear.length;
    }

    await tx.insert(schema.auditLog).values({
      userId,
      versionId,
      entity: 'fusion_sync',
      action: 'leases',
      changes: { matched: result.matched, skipped, createdUnits: result.createdUnits.length, cleared: result.cleared, unknown: result.unknownProperties.slice(0, 20) },
    });
    await recalcLines(tx, versionId);
  });

  // new units need a submission row in this version
  await db.execute(sql`
    insert into submissions (version_id, property_id, status)
    select distinct ${versionId}::int, property_id, 'DRAFT'::submission_status from lease_lines where version_id = ${versionId}
    on conflict do nothing`);
  return result;
}

/** Update unit attributes (status, merged unit, usage, landlord) from the Fusion Unit Dump. */
export async function applyUnitDump(versionId: number, dump: FusionUnit[], userId: number | null) {
  const unitsAll = await db.select().from(schema.units);
  const byCode = new Map(unitsAll.map((u) => [normUnit(u.unitCode), u]));
  let updated = 0;
  const unknown: string[] = [];
  const available: number[] = [];
  await db.transaction(async (tx) => {
    for (const d of dump) {
      const u = byCode.get(normUnit(d.unitCode));
      if (!u) {
        unknown.push(d.unitCode);
        continue;
      }
      await tx
        .update(schema.units)
        .set({
          unitStatus: d.unitStatus ?? u.unitStatus,
          mergedUnitNumber: d.mergedUnitNumber ?? u.mergedUnitNumber,
          resiCommercial: d.unitUsage ?? u.resiCommercial,
          landlord: d.landlord ?? u.landlord,
        })
        .where(eq(schema.units.id, u.id));
      if (/AVAILABLE|VACANT/i.test(d.unitStatus ?? '')) available.push(u.id);
      updated++;
    }
    if (available.length) {
      await tx
        .update(schema.leaseLines)
        .set({ vacant: true })
        .where(and(eq(schema.leaseLines.versionId, versionId), inArray(schema.leaseLines.unitId, available)));
    }
    await tx.insert(schema.auditLog).values({
      userId,
      versionId,
      entity: 'fusion_sync',
      action: 'units',
      changes: { updated, unknown: unknown.length },
    });
  });
  return { updated, unknown: unknown.length, available: available.length };
}
