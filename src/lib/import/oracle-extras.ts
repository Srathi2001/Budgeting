// The two Oracle exports that add to the Tenant and Lease Details Report:
// - Unit Dump: landlord, merged unit number, unit usage and unit status per unit;
// - Maintenance Fee Report: MF Yes / No / Waived Off, amount and payment status per current lease.
import { readTables, records } from './oracle-html';

export interface UnitDumpRow {
  buCode: string | null;
  landlord: string | null;
  propertyName: string | null;
  unitCode: string;
  unitStatus: string | null;
  leaseNumber: string | null;
  mergedUnitNumber: string | null;
  unitUsage: string | null;
}

export interface MfRow {
  leaseNumber: string | null;
  unitCode: string;
  tenantCode: string | null;
  /** Yes / No / Waived Off */
  status: string | null;
  amount: number | null;
  paidDate: string | null;
  paid: number | null;
  outstanding: number | null;
}

const num = (v: string | null) => {
  if (v === null) return null;
  const n = Number(v.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
/** dd-mm-yyyy or dd/mm/yyyy → yyyy-mm-dd */
const day = (v: string | null) => {
  const m = v ? /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(v) : null;
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

export function parseUnitDump(data: Buffer): UnitDumpRow[] {
  const rows = records(readTables(data), 'UNIT CODE');
  if (!rows.length || !('MERGED UNIT NUMBER' in rows[0] || 'UNIT USAGE' in rows[0])) {
    throw new Error('This does not look like the Unit Dump (no "Unit Code" / "Merged Unit Number" columns)');
  }
  return rows.map((r) => ({
    buCode: r.BU_CODE ?? null,
    landlord: r.LANDLORD ?? null,
    propertyName: r['PROPERTY NAME'] ?? null,
    unitCode: r['UNIT CODE']!,
    unitStatus: r['UNIT STATUS'] ?? null,
    leaseNumber: r['LEASE NUMBER'] ?? null,
    mergedUnitNumber: r['MERGED UNIT NUMBER'] ?? null,
    unitUsage: r['UNIT USAGE'] ?? null,
  }));
}

export function parseMfReport(data: Buffer): MfRow[] {
  const rows = records(readTables(data), 'UNIT CODE');
  const statusKey = rows[0] && Object.keys(rows[0]).find((k) => /^MF\s*\(Y\/N/.test(k));
  if (!rows.length || !statusKey) throw new Error('This does not look like the Maintenance Fee Report (no "MF(Y/N/WO)" column)');
  const paidKey = Object.keys(rows[0]).find((k) => /PAID AMOUNT/.test(k));
  const dateKey = Object.keys(rows[0]).find((k) => /PAYMENT DATE/.test(k));
  return rows.map((r) => ({
    leaseNumber: r['LEASE NUMBER'] ?? null,
    unitCode: r['UNIT CODE']!,
    tenantCode: r['TENANT CODE'] ?? null,
    status: r[statusKey] ?? null,
    amount: num(r['MF AMOUNT'] ?? null),
    paidDate: dateKey ? day(r[dateKey] ?? null) : null,
    paid: paidKey ? num(r[paidKey] ?? null) : null,
    outstanding: num(r.OUTSTANDING ?? null),
  }));
}
