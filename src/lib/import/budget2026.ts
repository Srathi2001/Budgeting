// Parser for the finance master workbook (H.E. MJN_Budget 2026.xlsm).
// Reads the Revenue Master, Camps New, Other Income and Revenue Analysis sheets
// into plain records. Sheet names in this workbook use 'x' where a space would be.

import * as XLSX from 'xlsx';
import { type Day, dayFromExcelSerial, dayFromYMD } from '../engine/dates';

type WS = XLSX.WorkSheet;

function cell(ws: WS, col: string, row: number): unknown {
  const c = ws[`${col}${row}`];
  return c ? c.v : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/** True when a date cell holds a 1900-era placeholder (00/01/1900 etc.) rather than a real date. */
function isPlaceholderDate(v: unknown): boolean {
  return typeof v === 'number' && v >= 0 && v <= 1000;
}

function day(v: unknown): Day | null {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  if (typeof v === 'number') return v > 1000 ? dayFromExcelSerial(v) : null;
  if (v instanceof Date) return dayFromYMD(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  const s = String(v).trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); // dd/mm/yyyy
  if (m) return dayFromYMD(+m[3], +m[2], +m[1]);
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return dayFromYMD(+m[1], +m[2], +m[3]);
  return null;
}

/** 'Y' -> true, 'N' -> false, anything else ('-', '0', blank) -> null */
function yn(v: unknown): boolean | null {
  const s = str(v)?.toUpperCase();
  if (s === 'Y') return true;
  if (s === 'N') return false;
  return null;
}

const cols = (from: string, n: number) => {
  const start = XLSX.utils.decode_col(from);
  return Array.from({ length: n }, (_, i) => XLSX.utils.encode_col(start + i));
};

export interface ParsedLease {
  source: 'REVENUE_MASTER' | 'CAMPS';
  row: number;
  buCode: string;
  coordinator: string | null;
  propertyName: string;
  propertyCode: string;
  unitCode: string;
  tenant: string | null;
  bedroom: string | null;
  area: number | null;
  rc: 'R' | 'C' | 'L';
  pivotCategory: string | null;
  unitType: string | null;
  rooms: number | null;
  capacity: number | null;
  vacant: boolean;
  staffOwner: 'STAFF' | 'OWNER' | null;
  mfCurrent: boolean | null;
  currentRent: number | null;
  currentStart: Day | null;
  currentEnd: Day | null;
  renew1: boolean;
  noRenewal: boolean;
  r1Mf: boolean | null;
  r1Rent: number | null;
  r1Start: Day | null;
  r1End: Day | null;
  r2Renew: boolean | null;
  r2Mf: boolean | null;
  r2Rent: number | null;
  r2Start: Day | null;
  r2End: Day | null;
  excelRevenue: number[];
  excelCash: number[] | null;
}

function rc(v: unknown): 'R' | 'C' | 'L' {
  const s = str(v)?.toUpperCase();
  return s === 'R' ? 'R' : s === 'L' ? 'L' : 'C';
}

export function parseRevenueMaster(wb: XLSX.WorkBook): ParsedLease[] {
  const ws = wb.Sheets['RevenuexMaster'] ?? wb.Sheets['Revenue Master'];
  if (!ws) throw new Error('Revenue Master sheet not found');
  const last = XLSX.utils.decode_range(ws['!ref']!).e.r + 1;
  const revCols = cols('AF', 12);
  const cashCols = cols('AT', 12);
  const out: ParsedLease[] = [];
  for (let r = 3; r <= last; r++) {
    const unitCode = str(cell(ws, 'F', r));
    if (!unitCode) continue;
    const so = str(cell(ws, 'N', r))?.toUpperCase();
    out.push({
      source: 'REVENUE_MASTER',
      row: r,
      buCode: String(str(cell(ws, 'B', r)) ?? ''),
      coordinator: str(cell(ws, 'C', r))?.toUpperCase() ?? null,
      propertyName: str(cell(ws, 'D', r)) ?? '',
      propertyCode: str(cell(ws, 'E', r)) ?? '',
      unitCode,
      tenant: str(cell(ws, 'G', r)),
      bedroom: str(cell(ws, 'H', r)),
      area: num(cell(ws, 'I', r)),
      rc: rc(cell(ws, 'J', r)),
      pivotCategory: str(cell(ws, 'K', r)),
      unitType: str(cell(ws, 'L', r)),
      rooms: null,
      capacity: null,
      vacant: yn(cell(ws, 'M', r)) === true,
      staffOwner: so === 'STAFF' || so === 'OWNER' ? so : null,
      mfCurrent: yn(cell(ws, 'O', r)),
      currentRent: num(cell(ws, 'P', r)),
      currentStart: day(cell(ws, 'Q', r)),
      currentEnd: day(cell(ws, 'R', r)),
      renew1: yn(cell(ws, 'S', r)) !== false,
      noRenewal: isPlaceholderDate(cell(ws, 'X', r)),
      r1Mf: yn(cell(ws, 'T', r)),
      r1Rent: num(cell(ws, 'U', r)),
      r1Start: day(cell(ws, 'X', r)),
      r1End: day(cell(ws, 'Y', r)),
      r2Renew: yn(cell(ws, 'Z', r)),
      r2Mf: yn(cell(ws, 'AA', r)),
      r2Rent: num(cell(ws, 'AB', r)),
      r2Start: day(cell(ws, 'AC', r)),
      r2End: day(cell(ws, 'AD', r)),
      excelRevenue: revCols.map((c) => num(cell(ws, c, r)) ?? 0),
      excelCash: cashCols.map((c) => num(cell(ws, c, r)) ?? 0),
    });
  }
  return out;
}

export function parseCamps(wb: XLSX.WorkBook): ParsedLease[] {
  const ws = wb.Sheets['CampsxNew'] ?? wb.Sheets['Camps New'];
  if (!ws) throw new Error('Camps New sheet not found');
  const last = XLSX.utils.decode_range(ws['!ref']!).e.r + 1;
  const revCols = cols('Z', 12);
  const out: ParsedLease[] = [];
  for (let r = 4; r <= last; r++) {
    const propertyCode = str(cell(ws, 'C', r));
    const unitCode = str(cell(ws, 'D', r));
    if (!propertyCode || !unitCode) continue;
    out.push({
      source: 'CAMPS',
      row: r,
      buCode: '502',
      coordinator: 'PACKI',
      propertyName: str(cell(ws, 'B', r)) ?? '',
      propertyCode,
      unitCode,
      tenant: str(cell(ws, 'E', r)),
      bedroom: str(cell(ws, 'F', r)),
      area: null,
      rc: 'L',
      pivotCategory: 'Camps',
      unitType: 'CAMP',
      rooms: num(cell(ws, 'G', r)),
      capacity: num(cell(ws, 'I', r)),
      vacant: yn(cell(ws, 'J', r)) === true,
      staffOwner: null,
      mfCurrent: null,
      currentRent: num(cell(ws, 'K', r)),
      currentStart: day(cell(ws, 'M', r)),
      currentEnd: day(cell(ws, 'N', r)),
      renew1: yn(cell(ws, 'O', r)) !== false,
      noRenewal: isPlaceholderDate(cell(ws, 'R', r)),
      r1Mf: false,
      r1Rent: num(cell(ws, 'P', r)),
      r1Start: day(cell(ws, 'R', r)),
      r1End: day(cell(ws, 'S', r)),
      r2Renew: yn(cell(ws, 'T', r)),
      r2Mf: false,
      r2Rent: num(cell(ws, 'U', r)),
      r2Start: day(cell(ws, 'W', r)),
      r2End: day(cell(ws, 'X', r)),
      excelRevenue: revCols.map((c) => num(cell(ws, c, r)) ?? 0),
      excelCash: null,
    });
  }
  return out;
}

export interface ParsedOtherIncome {
  propertyCode: string;
  propertyName: string;
  buCode: string | null;
  glCode: string;
  glName: string;
  owner: string | null;
  amount: number;
}

export function parseOtherIncome(wb: XLSX.WorkBook): ParsedOtherIncome[] {
  const ws = wb.Sheets['OtherxIncome'] ?? wb.Sheets['Other Income'];
  if (!ws) return [];
  const glCols = cols('E', 25); // E..AC
  const out: ParsedOtherIncome[] = [];
  const last = XLSX.utils.decode_range(ws['!ref']!).e.r + 1;
  for (let r = 6; r <= last; r++) {
    const code = str(cell(ws, 'B', r));
    const name = str(cell(ws, 'C', r));
    // property rows have a code that looks like 30B101 / 10B105N / 602A06N
    if (!code || !/^\d{2,3}[A-Z]\d{2,3}N?$/i.test(code)) continue;
    for (const c of glCols) {
      const amount = num(cell(ws, c, r));
      const gl = str(cell(ws, c, 4));
      if (!gl || !amount) continue;
      out.push({
        propertyCode: code,
        propertyName: name ?? code,
        buCode: str(cell(ws, 'D', r)),
        glCode: gl,
        glName: str(cell(ws, c, 5)) ?? gl,
        owner: str(cell(ws, c, 2)),
        amount,
      });
    }
  }
  return out;
}

export interface ParsedGl {
  code: string;
  name: string;
  owner: string | null;
}

export function parseGlAccounts(wb: XLSX.WorkBook): ParsedGl[] {
  const ws = wb.Sheets['OtherxIncome'] ?? wb.Sheets['Other Income'];
  if (!ws) return [];
  return cols('E', 25)
    .map((c) => ({ code: str(cell(ws, c, 4)), name: str(cell(ws, c, 5)), owner: str(cell(ws, c, 2)) }))
    .filter((g): g is ParsedGl => !!g.code && !!g.name);
}

export interface ParsedAnalysisRow {
  buLabel: string | null;
  propertyCode: string;
  propertyName: string;
  units: string | null;
  values: Record<string, number | null>; // label -> amount, e.g. '2026B', '2025F'
  vacancyLoss: number | null;
  comment: string | null;
}

export function parseRevenueAnalysis(wb: XLSX.WorkBook): ParsedAnalysisRow[] {
  const ws = wb.Sheets['RevenuexAnalysis'] ?? wb.Sheets['Revenue Analysis'];
  if (!ws) return [];
  const labels: Record<string, string> = { G: '2026B', H: '2025F', K: '2025B', M: '2024A', N: '2023A' };
  const out: ParsedAnalysisRow[] = [];
  const last = XLSX.utils.decode_range(ws['!ref']!).e.r + 1;
  for (let r = 5; r <= last; r++) {
    const code = str(cell(ws, 'E', r));
    if (!code || !/^\d{2,3}[A-Z]\d{2,3}N?$/i.test(code)) continue;
    const values: Record<string, number | null> = {};
    for (const [c, label] of Object.entries(labels)) values[label] = num(cell(ws, c, r));
    out.push({
      buLabel: str(cell(ws, 'D', r)),
      propertyCode: code,
      propertyName: str(cell(ws, 'F', r)) ?? code,
      units: str(cell(ws, 'C', r)),
      values,
      vacancyLoss: num(cell(ws, 'O', r)),
      comment: str(cell(ws, 'Q', r)),
    });
  }
  return out;
}

export function readWorkbook(data: Buffer | ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(data, {
    type: 'buffer',
    sheets: ['RevenuexMaster', 'CampsxNew', 'OtherxIncome', 'RevenuexAnalysis'],
    cellDates: false,
  });
}

/** Property codes appear both with and without the trailing 'N' (10B105N vs 10B105). */
export function normPropertyCode(code: string): string {
  return code.trim().toUpperCase().replace(/N$/, '');
}
