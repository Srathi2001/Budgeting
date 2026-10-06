// Lease Budget input template: download, fill in Excel, upload.
//
// Sheet 1 "Instructions" explains what to fill in. Sheet 2 "Lease Budget" has one row per line:
// fixed columns (Oracle import, calculated) are locked and shaded; input columns are unlocked only
// where the user may change them in the tool. On upload only the input columns are read, and every
// change goes through the same save path as the grid (permissions, fixed fields, validation).
import ExcelJS from 'exceljs';
import type { MasterRow, RowPatch } from './master-types';
import { annualRent, needsVacancyDays, outcomeOf, outcomePatch, OUTCOMES, type Outcome } from '@/app/(app)/master/row-logic';

const SHEET = 'Lease Budget';
const HEADER_ROW = 2;
const PASSWORD = 'lease-budget';

type Kind = 'text' | 'int' | 'money' | 'pct' | 'date';
interface Col {
  key: string;
  header: string;
  width: number;
  kind: Kind;
  /** input column: unlocked where `open(row)` */
  input?: { open: (r: MasterRow) => boolean; list?: readonly string[]; help: string };
  get: (r: MasterRow) => string | number | Date | null;
  help?: string;
}

const date = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : null);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Columns, in sheet order. */
export function templateColumns(year: number): Col[] {
  return [
    { key: 'lineId', header: 'Line ID', width: 9, kind: 'int', get: (r) => r.lineId, help: 'Identifies the line. Don’t change it.' },
    { key: 'property', header: 'Property', width: 30, kind: 'text', get: (r) => r.propertyName },
    { key: 'unitCode', header: 'Unit', width: 22, kind: 'text', get: (r) => r.unitCode },
    { key: 'unitType', header: 'Unit type', width: 20, kind: 'text', get: (r) => r.resiCommercial ?? r.unitType },
    { key: 'bedroom', header: 'RERA code', width: 12, kind: 'text', get: (r) => r.bedroom },
    { key: 'area', header: 'Area (sq ft)', width: 11, kind: 'money', get: (r) => r.area },
    { key: 'tenantCode', header: 'Tenant code', width: 12, kind: 'text', get: (r) => r.tenantCode },
    { key: 'tenant', header: 'Tenant', width: 32, kind: 'text', get: (r) => r.tenant },
    { key: 'leaseNumber', header: 'Lease no.', width: 15, kind: 'text', get: (r) => r.leaseNumber },
    { key: 'currentStart', header: 'Contract start', width: 12, kind: 'date', get: (r) => date(r.currentStart) },
    { key: 'currentEnd', header: 'Contract end', width: 12, kind: 'date', get: (r) => date(r.currentEnd) },
    { key: 'currentRent', header: 'Contract amount', width: 14, kind: 'money', get: (r) => r.currentRent },
    { key: 'annualRent', header: 'Annual rent', width: 13, kind: 'money', get: (r) => annualRent(r) },
    { key: 'contracted', header: 'Contracted years', width: 10, kind: 'int', get: (r) => r.contracted || null, help: 'Later lease years already contracted in Oracle: the renewals are fixed.' },
    {
      key: 'outcome',
      header: 'Outcome',
      width: 13,
      kind: 'text',
      get: (r) => (r.staffOwner === 'OWNER' ? null : outcomeOf(r)),
      input: {
        open: (r) => !r.contracted && r.staffOwner !== 'OWNER',
        list: OUTCOMES,
        help: 'At the end of the current lease: Renew, New tenant or Not re-let. A vacant unit can only be New tenant or Not re-let.',
      },
    },
    {
      key: 'vacancyDays',
      header: 'Vacancy days',
      width: 10,
      kind: 'int',
      get: (r) => r.vacancyDays,
      input: {
        open: (r) => !!r.currentEnd && !r.contracted && r.staffOwner !== 'OWNER',
        help: 'Required when the outcome is New tenant: empty days between the lease end and the new tenant. 0 = the next day.',
      },
    },
    {
      key: 'increasePctOverride',
      header: 'Increase % (override)',
      width: 12,
      kind: 'pct',
      get: (r) => r.increasePctOverride,
      input: { open: (r) => !!r.currentEnd && !r.contracted, help: 'Renewals only. Blank = calculated from the RERA index.' },
    },
    {
      key: 'budgetRate',
      header: 'Budget rate',
      width: 12,
      kind: 'money',
      get: (r) => r.budgetRate,
      input: {
        open: () => true,
        help: 'New tenant rate. Residential: annual rent. Commercial and labour: AED per sq ft per year. Camps: AED per bed per month.',
      },
    },
    {
      key: 'r1Start',
      header: 'Renewal / new tenant start (override)',
      width: 14,
      kind: 'date',
      get: (r) => date(r.r1Start),
      input: {
        open: (r) => !r.contracted,
        help: 'Renewals and vacant units only. Blank = the day after the lease ends. A new tenant after a current lease starts after its vacancy days; a date here is ignored.',
      },
    },
    {
      key: 'r1Rent',
      header: 'Renewal rent (override)',
      width: 14,
      kind: 'money',
      get: (r) => r.r1Rent,
      input: { open: (r) => !r.contracted, help: 'Blank = calculated (RERA increase, or the budget rate for a new tenant).' },
    },
    {
      key: 'cheques',
      header: 'Cheques per year',
      width: 10,
      kind: 'int',
      get: (r) => r.cheques,
      input: { open: () => true, help: '1 to 12. Blank = 4.' },
    },
    {
      key: 'staffOwner',
      header: 'Staff / Owner',
      width: 11,
      kind: 'text',
      get: (r) => r.staffOwner,
      input: { open: () => true, list: ['STAFF', 'OWNER'], help: 'STAFF: rent compared with RERA after the staff discount. OWNER: owner-occupied, no renewal. Blank = neither.' },
    },
    {
      key: 'capacity',
      header: 'Beds (camps)',
      width: 9,
      kind: 'int',
      get: (r) => r.capacity,
      input: { open: (r) => r.propertyKind === 'CAMP', help: 'Camps only: beds, for the per-bed budget rate.' },
    },
    {
      key: 'reraMin',
      header: 'RERA low',
      width: 11,
      kind: 'money',
      get: (r) => r.reraMin,
      input: { open: (r) => !!r.bedroom, help: 'Annual rent range for the property and RERA code: the same for every unit with that code. Enter both low and high.' },
    },
    {
      key: 'reraMax',
      header: 'RERA high',
      width: 11,
      kind: 'money',
      get: (r) => r.reraMax,
      input: { open: (r) => !!r.bedroom, help: 'See RERA low.' },
    },
    { key: 'notes', header: 'Notes', width: 36, kind: 'text', get: (r) => r.notes, input: { open: () => true, help: 'Free text.' } },
    { key: 'calcStart', header: 'Renewal start (calculated)', width: 13, kind: 'date', get: (r) => date(r.r1?.start) },
    { key: 'calcRent', header: 'Renewal rent (calculated)', width: 13, kind: 'money', get: (r) => r.r1?.rent ?? null },
    { key: 'revenue', header: `Revenue ${year}`, width: 14, kind: 'money', get: (r) => r.revenueTotal },
    { key: 'issues', header: 'Issues', width: 40, kind: 'text', get: (r) => (r.warnings.length ? r.warnings.join('; ') : null) },
  ];
}

const FILL = {
  fixed: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } } as ExcelJS.Fill,
  input: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } } as ExcelJS.Fill,
  inputHead: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CC' } } as ExcelJS.Fill,
  head: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F1F1F' } } as ExcelJS.Fill,
};
const THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } } as ExcelJS.Border;
const numFmt: Record<Kind, string | undefined> = { text: '@', int: '0', money: '#,##0', pct: '0.0%', date: 'dd-mmm-yyyy' };

export async function buildTemplate(rows: MasterRow[], ctx: { versionName: string; year: number; user: string; scope: string }): Promise<Buffer> {
  const cols = templateColumns(ctx.year);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Revenue Budget';
  wb.created = new Date();

  // ---- sheet 1: instructions
  const info = wb.addWorksheet('Instructions', { properties: { tabColor: { argb: 'FF1F1F1F' } } });
  info.columns = [{ width: 30 }, { width: 14 }, { width: 100 }];
  const line = (text: string, bold = false, size = 11) => {
    const r = info.addRow([text]);
    r.font = { bold, size };
    info.mergeCells(r.number, 1, r.number, 3);
    r.alignment = { wrapText: true, vertical: 'top' };
  };
  line(`Lease Budget input template · ${ctx.versionName}`, true, 14);
  line(`${ctx.scope} · ${rows.length} lines · downloaded ${new Date().toISOString().slice(0, 10)} by ${ctx.user}`);
  info.addRow([]);
  line('What to do', true, 12);
  for (const s of [
    '1. Go to the “Lease Budget” sheet. Fill in the white cells only. Grey cells are fixed: they come from the Oracle import or are calculated, and the sheet is protected.',
    '2. A white cell left blank means “no value”: for an override, the tool’s calculated value is used; for vacancy days on a new tenant, the line is flagged until filled in.',
    '3. Don’t add, delete or reorder rows or columns, and don’t change the Line ID.',
    '4. Save the file as .xlsx and upload it in the tool: Lease Budget → Import Excel. You’ll see every change before it is applied.',
    '5. The upload follows the same rules as the tool: only lines you may edit, only the fields you may change. Anything else is listed as rejected.',
  ])
    line(s);
  info.addRow([]);
  line('Columns', true, 12);
  const h = info.addRow(['Column', 'Type', 'What to enter']);
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h.eachCell((c) => (c.fill = FILL.head));
  for (const c of cols) {
    const r = info.addRow([c.header, c.input ? 'Input' : 'Fixed', c.input ? `${c.input.help}${c.input.list ? ` Allowed: ${c.input.list.join(', ')}.` : ''}` : (c.help ?? 'From the Oracle import or calculated by the tool.')]);
    r.alignment = { wrapText: true, vertical: 'top' };
    r.getCell(2).fill = c.input ? FILL.inputHead : FILL.fixed;
    r.eachCell((cell) => (cell.border = { top: THIN, bottom: THIN, left: THIN, right: THIN }));
  }

  // ---- sheet 2: lease budget
  const ws = wb.addWorksheet(SHEET, { views: [{ state: 'frozen', xSplit: 3, ySplit: HEADER_ROW }] });
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width }));
  // row 1: group band, row 2: column names
  const band = ws.getRow(1);
  const names = ws.getRow(HEADER_ROW);
  cols.forEach((c, i) => {
    const b = band.getCell(i + 1);
    b.value = c.input ? 'Input' : 'Fixed';
    b.font = { bold: true, size: 9, color: { argb: c.input ? 'FF7A5B00' : 'FF595959' } };
    b.fill = c.input ? FILL.inputHead : FILL.fixed;
    const n = names.getCell(i + 1);
    n.value = c.header;
    n.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    n.fill = FILL.head;
    n.alignment = { wrapText: true, vertical: 'middle' };
  });
  names.height = 32;

  rows.forEach((r) => {
    const row = ws.addRow(cols.map((c) => c.get(r)));
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const open = !!c.input && r.editable && c.input.open(r);
      cell.protection = { locked: !open };
      cell.fill = open ? FILL.input : FILL.fixed;
      cell.border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
      if (numFmt[c.kind] && c.kind !== 'text') cell.numFmt = numFmt[c.kind]!;
      if (!open) cell.font = { color: { argb: 'FF404040' } };
      if (open && c.input?.list) cell.dataValidation = { type: 'list', allowBlank: true, formulae: [`"${c.input.list.join(',')}"`], showErrorMessage: true, error: `Choose ${c.input.list.join(', ')}` };
      if (open && c.kind === 'int') cell.dataValidation = { type: 'whole', operator: 'between', allowBlank: true, formulae: [c.key === 'cheques' ? 1 : 0, c.key === 'cheques' ? 12 : 100000], showErrorMessage: true, error: 'Whole number' };
      if (open && (c.kind === 'money' || c.kind === 'pct')) cell.dataValidation = { type: 'decimal', operator: c.kind === 'pct' ? 'between' : 'greaterThanOrEqual', allowBlank: true, formulae: c.kind === 'pct' ? [-1, 5] : [0], showErrorMessage: true, error: 'Number' };
      if (open && c.kind === 'date') cell.dataValidation = { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1))], showErrorMessage: true, error: 'Date' };
      if (open && c.key === 'vacancyDays' && needsVacancyDays(r) && r.vacancyDays === null) cell.fill = FILL.inputHead; // required, still blank
    });
  });
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: cols.length } };
  await ws.protect(PASSWORD, { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, autoFilter: true, sort: false });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---- upload --------------------------------------------------------------------------------------

export interface UploadRow {
  excelRow: number;
  lineId: number;
  values: Record<string, unknown>;
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return (v as ExcelJS.CellHyperlinkValue).text;
    return null;
  }
  if (typeof v === 'string' && v.trim() === '') return null;
  return v;
}

/** Reads the input columns of an uploaded template. */
export async function readTemplate(data: ArrayBuffer, year: number): Promise<{ rows: UploadRow[]; error?: string }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    return { rows: [], error: 'Not an Excel (.xlsx) file' };
  }
  const ws = wb.getWorksheet(SHEET);
  if (!ws) return { rows: [], error: `No “${SHEET}” sheet: upload the template downloaded from the tool` };
  const cols = templateColumns(year).filter((c) => c.input || c.key === 'lineId');
  const at = new Map<string, number>();
  ws.getRow(HEADER_ROW).eachCell((cell, n) => {
    const c = cols.find((x) => x.header === String(cell.value ?? '').trim());
    if (c) at.set(c.key, n);
  });
  if (!at.has('lineId')) return { rows: [], error: 'The Line ID column is missing: upload the template downloaded from the tool' };
  const rows: UploadRow[] = [];
  ws.eachRow((row, n) => {
    if (n <= HEADER_ROW) return;
    const id = Number(cellValue(row.getCell(at.get('lineId')!).value));
    if (!Number.isInteger(id) || id <= 0) return;
    const values: Record<string, unknown> = {};
    for (const c of cols) if (c.input && at.has(c.key)) values[c.key] = cellValue(row.getCell(at.get(c.key)!).value);
    rows.push({ excelRow: n, lineId: id, values });
  });
  return { rows };
}

export interface UploadChange {
  excelRow: number;
  lineId: number;
  unit: string;
  field: string;
  from: string;
  to: string;
}

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : v instanceof Date ? iso(v) : String(v));
const num = (v: unknown): number | null | 'bad' => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,%\s]/g, ''));
  return Number.isFinite(n) ? n : 'bad';
};
const day = (v: unknown): string | null | 'bad' => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return iso(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v)) ?? null;
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(String(v).trim());
  return d ? `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}` : 'bad';
};

/**
 * Compares uploaded inputs with the current lines. Returns the patches to save, the RERA ranges to
 * save, a readable list of changes, and errors (values that can't be read; locked cells changed).
 */
export function diffUpload(uploaded: UploadRow[], current: Map<number, MasterRow>, year: number) {
  const cols = templateColumns(year).filter((c) => c.input);
  const patches = new Map<number, RowPatch>();
  const changes: UploadChange[] = [];
  const errors: { excelRow: number; unit: string; message: string }[] = [];
  const rera = new Map<string, { propertyId: number; bedroom: string; min: number | null; max: number | null; excelRow: number; unit: string }>();

  for (const u of uploaded) {
    const r = current.get(u.lineId);
    if (!r) {
      errors.push({ excelRow: u.excelRow, unit: `Line ${u.lineId}`, message: 'Line not in this budget (or not visible to you)' });
      continue;
    }
    const patch: RowPatch = {};
    const note = (field: string, from: unknown, to: unknown) => changes.push({ excelRow: u.excelRow, lineId: r.lineId, unit: r.unitCode, field, from: show(from), to: show(to) });
    const bad = (field: string, v: unknown) => errors.push({ excelRow: u.excelRow, unit: r.unitCode, message: `${field}: can’t read “${show(v)}”` });
    let reraMin: number | null = r.reraMin, reraMax: number | null = r.reraMax, reraTouched = false;

    for (const c of cols) {
      if (!(c.key in u.values)) continue;
      const v = u.values[c.key];
      const open = r.editable && c.input!.open(r);
      if (c.key === 'outcome') {
        if (v === null) continue;
        const o = OUTCOMES.find((x) => x.toLowerCase() === String(v).trim().toLowerCase());
        if (!o) {
          bad('Outcome', v);
          continue;
        }
        if (o === outcomeOf(r)) continue;
        if (!open) {
          errors.push({ excelRow: u.excelRow, unit: r.unitCode, message: 'Outcome is fixed on this line' });
          continue;
        }
        if (o === 'Renew' && !r.currentEnd) {
          errors.push({ excelRow: u.excelRow, unit: r.unitCode, message: 'A vacant unit can’t renew' });
          continue;
        }
        Object.assign(patch, outcomePatch(o as Outcome));
        note('Outcome', outcomeOf(r), o);
        continue;
      }
      let next: unknown;
      let before: unknown;
      if (c.kind === 'date') {
        next = day(v);
        before = (r as unknown as Record<string, unknown>)[c.key] ?? null;
      } else if (c.kind === 'text') {
        next = v === null ? null : c.key === 'staffOwner' ? String(v).trim().toUpperCase() : String(v).trim();
        before = (r as unknown as Record<string, unknown>)[c.key] ?? null;
        if (c.key === 'staffOwner' && next !== null && !['STAFF', 'OWNER'].includes(next as string)) {
          bad('Staff / Owner', v);
          continue;
        }
      } else {
        next = num(v);
        if (next !== null && next !== 'bad' && c.kind === 'int') next = Math.round(next as number);
        before = (r as unknown as Record<string, unknown>)[c.key] ?? null;
      }
      if (next === 'bad') {
        bad(c.header, v);
        continue;
      }
      const same = typeof next === 'number' && typeof before === 'number' ? Math.abs(next - before) < 0.005 : JSON.stringify(next) === JSON.stringify(before);
      if (same) continue;
      if (!open) {
        errors.push({ excelRow: u.excelRow, unit: r.unitCode, message: `${c.header} is fixed on this line` });
        continue;
      }
      if (c.key === 'reraMin' || c.key === 'reraMax') {
        if (c.key === 'reraMin') reraMin = next as number | null;
        else reraMax = next as number | null;
        reraTouched = true;
        continue;
      }
      (patch as Record<string, unknown>)[c.key] = next;
      note(c.header, before, next);
    }

    if (reraTouched) {
      const k = `${r.propertyId}|${(r.bedroom ?? '').toUpperCase()}`;
      const prev = rera.get(k);
      if (prev && (prev.min !== reraMin || prev.max !== reraMax)) {
        errors.push({ excelRow: u.excelRow, unit: r.unitCode, message: `RERA range differs from ${prev.unit} (row ${prev.excelRow}) for the same property and code` });
      } else if (!prev) {
        rera.set(k, { propertyId: r.propertyId, bedroom: r.bedroom!, min: reraMin, max: reraMax, excelRow: u.excelRow, unit: r.unitCode });
        note(`RERA ${r.propertyCode} ${r.bedroom}`, r.reraMin === null ? null : `${r.reraMin}–${r.reraMax}`, reraMin === null ? null : `${reraMin}–${reraMax}`);
      }
    }
    if (Object.keys(patch).length) patches.set(r.lineId, patch);
  }
  return { patches, rera: [...rera.values()], changes, errors };
}
