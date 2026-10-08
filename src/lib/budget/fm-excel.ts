// FM Budget input template: download, fill in Excel, upload.
//
// Sheet "Instructions" explains what to fill in; "Facilities" lists the facilities with last year's
// budget and actual (reference, locked); "FM Budget" has one row per budgeted cost already entered and
// blank rows for new costs. Lists (work types, elements, …) are on a hidden "Lists" sheet. On upload the
// input columns are compared with the tool and every change goes through the same save path as the
// form (permissions, submitted facilities, validation).
import ExcelJS from 'exceljs';
import { XL } from '@/lib/format';
import { BUSINESS_NEEDS, ELEMENTS, FM_KINDS, FM_KIND_LABEL, WORK_TYPE, WORK_TYPES, elementLabel, glOf, isWorkType, type FmKind } from './fm-types';
import type { FmLineRow } from './fm-page';

const SHEET = 'FM Budget';
const HEADER_ROW = 2;
const BLANK_ROWS = 400;
const PASSWORD = 'fm-budget';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const wtText = (code: string) => `${code} ${WORK_TYPE.get(code as never)?.label ?? ''}`.trim();
const elText = (code: string) => `${code} ${elementLabel(code)}`;

interface Col {
  key: string;
  header: string;
  width: number;
  input?: string;
  /** a range on the Lists sheet, for a drop-down */
  list?: string;
}
const COLS: Col[] = [
  { key: 'lineId', header: 'Line ID', width: 8 },
  { key: 'facility', header: 'Facility code', width: 13, input: 'New rows: the facility code (drop-down, see the Facilities sheet). Fixed on rows already in the tool.', list: 'facilities' },
  { key: 'facilityName', header: 'Facility', width: 34 },
  { key: 'workType', header: 'Work type', width: 34, input: 'M01–M04 maintain, R01–R04 renewal (R04 = capex items, GL 117xx).', list: 'workTypes' },
  { key: 'element', header: 'Element', width: 36, input: 'Building element; the GL account follows from it and the work type.', list: 'elements' },
  { key: 'gl', header: 'GL', width: 8 },
  { key: 'subElement', header: 'Sub-element', width: 22, input: 'Optional, e.g. Chiller, Lift, Pumps.' },
  { key: 'description', header: 'Description of works', width: 46, input: 'What is to be done.' },
  { key: 'businessNeed', header: 'Business need', width: 17, input: `${BUSINESS_NEEDS.join(', ')}.`, list: 'needs' },
  { key: 'kind', header: 'Type', width: 17, input: FM_KINDS.map((k) => `${k.label}: ${k.hint.toLowerCase()}`).join('. ') + '. Blank = Planned.', list: 'kinds' },
  { key: 'month', header: 'Month', width: 9, input: 'R01, R02 and R04 only: the month the cost falls. Blank = spread Jan–Dec. Recurring work (M01–M04, R03) is always spread over the year.', list: 'months' },
  { key: 'amount', header: 'Amount (AED)', width: 14, input: 'Above 0, excluding VAT.' },
  { key: 'remarks', header: 'Remarks', width: 30, input: 'Optional.' },
  { key: 'remove', header: 'Remove', width: 9, input: 'Rows already in the tool: Yes removes the cost.', list: 'yes' },
];
const COL_AT = new Map(COLS.map((c, i) => [c.key, i + 1]));
const letter = (key: string) => String.fromCharCode(64 + COL_AT.get(key)!);

const FILL = {
  fixed: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } } as ExcelJS.Fill,
  input: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } } as ExcelJS.Fill,
  inputHead: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CC' } } as ExcelJS.Fill,
  head: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F1F1F' } } as ExcelJS.Fill,
};
const THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } } as ExcelJS.Border;
const BOX = { top: THIN, bottom: THIN, left: THIN, right: THIN };

export interface FmTemplateFacility {
  id: number;
  code: string;
  name: string;
  bu: string;
  zone: string | null;
  prior: number | null;
  actual: number;
  budget: number;
  status: string;
  editable: boolean;
  lines: FmLineRow[];
}

export async function buildFmTemplate(
  facilities: FmTemplateFacility[],
  ctx: { versionName: string; year: number; user: string; scope: string; priorLabel: string | null; actualLabel: string; locked: boolean },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Budget';
  wb.created = new Date();
  const editable = facilities.filter((f) => f.editable);

  // ---- instructions
  const info = wb.addWorksheet('Instructions', { properties: { tabColor: { argb: 'FF1F1F1F' } } });
  info.columns = [{ width: 24 }, { width: 10 }, { width: 100 }];
  const line = (text: string, bold = false, size = 11) => {
    const r = info.addRow([text]);
    r.font = { bold, size };
    info.mergeCells(r.number, 1, r.number, 3);
    r.alignment = { wrapText: true, vertical: 'top' };
  };
  line(`FM Budget input template · ${ctx.versionName}`, true, 14);
  line(`${ctx.scope} · downloaded ${new Date().toISOString().slice(0, 10)} by ${ctx.user}`);
  info.addRow([]);
  line('What to do', true, 12);
  for (const s of [
    `1. Go to the “${SHEET}” sheet. Each row is one budgeted cost for ${ctx.year}. Fill in the white cells only; grey cells are fixed and the sheet is protected.`,
    '2. To add a cost, use a blank row at the bottom: choose the facility code, work type and element, then the description, business need, type, month (projects only) and amount.',
    '3. To change a cost already in the tool, change its white cells. To remove it, put Yes in Remove. Don’t change the Line ID.',
    '4. The Facilities sheet shows each facility with last year’s budget and actual for reference.',
    '5. Save the file as .xlsx and upload it in the tool: FM Budget → FM Budget Template → Import Excel. You see every change before it is applied.',
    '6. The upload follows the same rules as the tool: facilities submitted to Finance (or approved) can’t be changed until Finance returns them. Anything else is listed as rejected.',
  ])
    line(s);
  if (ctx.locked) line('This budget version is locked: the template is for reference only.', true);
  info.addRow([]);
  line('Columns', true, 12);
  const h = info.addRow(['Column', 'Type', 'What to enter']);
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h.eachCell((c) => (c.fill = FILL.head));
  for (const c of COLS) {
    const r = info.addRow([c.header, c.input ? 'Input' : 'Fixed', c.input ?? (c.key === 'gl' ? 'Follows from the work type and element.' : c.key === 'lineId' ? 'Identifies a cost already in the tool; blank on new rows.' : 'From the tool.')]);
    r.alignment = { wrapText: true, vertical: 'top' };
    r.getCell(2).fill = c.input ? FILL.inputHead : FILL.fixed;
    r.eachCell((cell) => (cell.border = BOX));
  }

  // ---- facilities (reference)
  const fs = wb.addWorksheet('Facilities', { views: [{ state: 'frozen', ySplit: 1 }] });
  const fcols = [
    ['Facility code', 13],
    ['Facility', 36],
    ['BU', 6],
    ['Zone', 8],
    ...(ctx.priorLabel ? [[ctx.priorLabel, 13]] : []),
    [ctx.actualLabel, 15],
    [`${ctx.year}B (in the tool)`, 15],
    ['Status', 11],
  ] as [string, number][];
  fs.columns = fcols.map(([, w]) => ({ width: w }));
  const fh = fs.addRow(fcols.map(([t]) => t));
  fh.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  fh.eachCell((c) => (c.fill = FILL.head));
  for (const f of facilities) {
    const r = fs.addRow([f.code, f.name, f.bu, f.zone?.replace('ZONE_', 'Zone ') ?? '', ...(ctx.priorLabel ? [f.prior ?? 0] : []), f.actual, f.budget, f.status === 'SUBMITTED' ? 'In review' : f.status.charAt(0) + f.status.slice(1).toLowerCase()]);
    r.eachCell((c, n) => {
      c.border = BOX;
      if (n > 4 && typeof c.value === 'number') c.numFmt = XL.amount;
    });
  }
  await fs.protect(PASSWORD, { selectLockedCells: true, selectUnlockedCells: true, autoFilter: true });

  // ---- lists (hidden)
  const ls = wb.addWorksheet('Lists', { state: 'hidden' });
  const lists: Record<string, string[]> = {
    facilities: editable.map((f) => f.code),
    workTypes: WORK_TYPES.map((w) => wtText(w.code)),
    elements: ELEMENTS.map((e) => elText(e.code)),
    needs: [...BUSINESS_NEEDS],
    kinds: FM_KINDS.map((k) => k.label),
    months: MONTHS,
    yes: ['Yes'],
  };
  const range: Record<string, string> = {};
  Object.entries(lists).forEach(([k, vals], i) => {
    const col = String.fromCharCode(65 + i);
    ls.getCell(`${col}1`).value = k;
    vals.forEach((v, j) => (ls.getCell(`${col}${j + 2}`).value = v));
    range[k] = `Lists!$${col}$2:$${col}$${Math.max(vals.length + 1, 2)}`;
  });

  // ---- FM Budget
  const ws = wb.addWorksheet(SHEET, { views: [{ state: 'frozen', xSplit: 3, ySplit: HEADER_ROW }] });
  ws.columns = COLS.map((c) => ({ key: c.key, width: c.width }));
  const band = ws.getRow(1);
  const names = ws.getRow(HEADER_ROW);
  COLS.forEach((c, i) => {
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
  names.height = 30;

  const style = (row: ExcelJS.Row, open: (key: string) => boolean) =>
    COLS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const o = !!c.input && open(c.key);
      cell.protection = { locked: !o };
      cell.fill = o ? FILL.input : FILL.fixed;
      cell.border = BOX;
      if (c.key === 'amount') cell.numFmt = XL.amount;
      if (o && c.list) cell.dataValidation = { type: 'list', allowBlank: true, formulae: [range[c.list]], showErrorMessage: c.list !== 'facilities', error: 'Choose from the list' };
      if (o && c.key === 'amount') cell.dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, error: 'Amount: a number of 0 or more' };
    });
  const glFormula = (n: number) => ({
    formula: `IF(OR(${letter('workType')}${n}="",${letter('element')}${n}=""),"",IF(LEFT(${letter('workType')}${n},3)="R04","117","627")&LEFT(${letter('element')}${n},2))`,
  });

  for (const f of facilities) {
    for (const l of f.lines) {
      const row = ws.addRow({
        lineId: l.id,
        facility: f.code,
        facilityName: f.name,
        workType: wtText(l.workType),
        element: elText(l.element),
        gl: null,
        subElement: l.subElement,
        description: l.description,
        businessNeed: l.businessNeed,
        kind: FM_KIND_LABEL[l.kind as FmKind] ?? l.kind,
        month: l.month ? MONTHS[l.month - 1] : null,
        amount: l.amount,
        remarks: l.remarks,
        remove: null,
      });
      row.getCell(COL_AT.get('gl')!).value = { ...glFormula(row.number), result: glOf(l.workType, l.element) };
      // lines that came from the FMD file keep what the work is (as in the tool)
      const tool = l.source !== 'FM';
      style(row, (k) => f.editable && !ctx.locked && k !== 'facility' && !(tool && ['workType', 'element', 'subElement', 'description', 'remove'].includes(k)));
    }
  }
  if (!ctx.locked && editable.length) {
    for (let i = 0; i < BLANK_ROWS; i++) {
      const row = ws.addRow({});
      const n = row.number;
      row.getCell(COL_AT.get('facilityName')!).value = { formula: `IFERROR(VLOOKUP(${letter('facility')}${n},Facilities!$A:$B,2,FALSE),"")` };
      row.getCell(COL_AT.get('gl')!).value = glFormula(n);
      style(row, (k) => k !== 'remove');
    }
  }
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: COLS.length } };
  await ws.protect(PASSWORD, { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, autoFilter: true, sort: false });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---- upload --------------------------------------------------------------------------------------

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('formula' in v) return null;
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return (v as ExcelJS.CellHyperlinkValue).text;
    return null;
  }
  if (typeof v === 'string' && v.trim() === '') return null;
  return v;
}

export interface FmUploadRow {
  excelRow: number;
  lineId: number | null;
  values: Record<string, unknown>;
}

export async function readFmTemplate(data: ArrayBuffer): Promise<{ rows: FmUploadRow[]; error?: string }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    return { rows: [], error: 'Not an Excel (.xlsx) file' };
  }
  const ws = wb.getWorksheet(SHEET);
  if (!ws) return { rows: [], error: `No “${SHEET}” sheet: upload the FM template downloaded from the tool` };
  const at = new Map<string, number>();
  ws.getRow(HEADER_ROW).eachCell((cell, n) => {
    const c = COLS.find((x) => x.header === String(cell.value ?? '').trim());
    if (c) at.set(c.key, n);
  });
  for (const k of ['lineId', 'facility', 'workType', 'element', 'amount']) if (!at.has(k)) return { rows: [], error: `The “${COLS.find((c) => c.key === k)!.header}” column is missing: upload the FM template downloaded from the tool` };
  const rows: FmUploadRow[] = [];
  ws.eachRow((row, n) => {
    if (n <= HEADER_ROW) return;
    const values: Record<string, unknown> = {};
    for (const c of COLS) if (c.input && at.has(c.key)) values[c.key] = cellValue(row.getCell(at.get(c.key)!).value);
    const rawId = cellValue(row.getCell(at.get('lineId')!).value);
    const id = rawId === null ? null : Number(rawId);
    if (id === null && Object.values(values).every((v) => v === null)) return;
    rows.push({ excelRow: n, lineId: id !== null && Number.isInteger(id) && id > 0 ? id : null, values });
  });
  return { rows };
}

export interface FmLineInput {
  id: number | null;
  workType: string;
  element: string;
  subElement: string | null;
  description: string | null;
  businessNeed: string | null;
  kind: string;
  amount: number;
  month: number | null;
  remarks: string | null;
}
export interface FmUploadChange {
  excelRow: number;
  facility: string;
  what: 'New' | 'Changed' | 'Removed';
  detail: string;
  amount: number;
}
export interface FmUploadError {
  excelRow: number;
  facility: string;
  message: string;
}

const txt = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
const parseWorkType = (v: unknown) => {
  const m = /^\s*([MR]0[1-4])\b/i.exec(String(v ?? ''));
  return m && isWorkType(m[1].toUpperCase()) ? m[1].toUpperCase() : null;
};
const parseElement = (v: unknown) => {
  const s = String(v ?? '').trim();
  const m = /^(\d{5}|\d{1,2})\b/.exec(s);
  const code = m ? (m[1].length === 5 ? m[1].slice(3, 5) : m[1].padStart(2, '0')) : (ELEMENTS.find((e) => e.label.toLowerCase() === s.toLowerCase())?.code ?? null);
  return code && ELEMENTS.some((e) => e.code === code) ? code : null;
};
const parseMonth = (v: unknown): number | null | 'bad' => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 12 ? v : 'bad';
  const i = MONTHS.findIndex((m) => String(v).trim().toLowerCase().startsWith(m.toLowerCase()));
  return i >= 0 ? i + 1 : 'bad';
};
const parseAmount = (v: unknown): number | null | 'bad' => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 'bad';
};

/** Compares the upload with the lines in the tool: per facility, the lines to save and the ones to remove. */
export function diffFmUpload(
  uploaded: FmUploadRow[],
  facilities: { id: number; code: string; editable: boolean; reason: string | null }[],
  current: Map<number, FmLineRow & { propertyId: number }>,
) {
  const byCode = new Map(facilities.map((f) => [f.code.toUpperCase(), f]));
  const byId = new Map(facilities.map((f) => [f.id, f]));
  const saves = new Map<number, { lines: FmLineInput[]; deleted: number[] }>();
  const changes: FmUploadChange[] = [];
  const errors: FmUploadError[] = [];
  const bucket = (id: number) => {
    let b = saves.get(id);
    if (!b) saves.set(id, (b = { lines: [], deleted: [] }));
    return b;
  };

  for (const u of uploaded) {
    const v = u.values;
    const existing = u.lineId !== null ? current.get(u.lineId) : undefined;
    const fac = existing ? byId.get(existing.propertyId) : byCode.get(String(v.facility ?? '').trim().toUpperCase());
    const code = fac?.code ?? (txt(v.facility) ?? '—');
    const err = (message: string) => errors.push({ excelRow: u.excelRow, facility: code, message });
    if (u.lineId !== null && !existing) {
      err('Line not in this budget (or not visible to you)');
      continue;
    }
    if (!fac) {
      err(txt(v.facility) ? `Unknown facility code ${txt(v.facility)}` : 'Choose the facility code');
      continue;
    }

    if (existing && /^y(es)?$/i.test(String(v.remove ?? '').trim())) {
      if (!fac.editable) err(fac.reason ?? 'This facility can’t be changed');
      else if (existing.source !== 'FM') err('Costs from the FMD file can’t be removed; set the amount to 0');
      else {
        bucket(fac.id).deleted.push(existing.id);
        changes.push({ excelRow: u.excelRow, facility: code, what: 'Removed', detail: `${existing.workType} ${existing.description ?? elementLabel(existing.element)}`, amount: existing.amount });
      }
      continue;
    }

    const workType = parseWorkType(v.workType);
    const element = parseElement(v.element);
    const month = parseMonth(v.month);
    const amount = parseAmount(v.amount);
    const kindText = txt(v.kind);
    const kind = kindText === null ? 'PLANNED' : (FM_KINDS.find((k) => k.label.toLowerCase() === kindText.toLowerCase() || k.code === kindText.toUpperCase())?.code ?? null);
    const needText = txt(v.businessNeed);
    const need = needText === null ? null : (BUSINESS_NEEDS.find((b) => b.toLowerCase() === needText.toLowerCase()) ?? 'bad');
    const problems = [
      !workType && 'work type',
      !element && 'element',
      month === 'bad' && 'month',
      (amount === 'bad' || amount === null || (!existing && amount === 0)) && 'amount',
      !kind && 'type',
      need === 'bad' && 'business need',
    ].filter(Boolean);
    if (problems.length) {
      err(`Check the ${problems.join(', ')}`);
      continue;
    }
    const line: FmLineInput = {
      id: existing?.id ?? null,
      workType: workType!,
      element: element!,
      subElement: txt(v.subElement),
      description: txt(v.description),
      businessNeed: need as string | null,
      kind: kind!,
      amount: amount as number,
      month: WORK_TYPE.get(workType as never)?.spread ? null : (month as number | null),
      remarks: txt(v.remarks),
    };
    if (existing) {
      const fields: [string, unknown, unknown][] = [
        ['work type', existing.workType, line.workType],
        ['element', existing.element, line.element],
        ['sub-element', existing.subElement, line.subElement],
        ['description', existing.description, line.description],
        ['business need', existing.businessNeed, line.businessNeed],
        ['type', existing.kind, line.kind],
        ['month', existing.month, line.month],
        ['amount', existing.amount, line.amount],
        ['remarks', existing.remarks, line.remarks],
      ];
      const diff = fields.filter(([, a, b]) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) >= 0.005 : (a ?? null) !== (b ?? null)));
      if (!diff.length) continue;
      if (!fac.editable) {
        err(fac.reason ?? 'This facility can’t be changed');
        continue;
      }
      bucket(fac.id).lines.push(line);
      changes.push({ excelRow: u.excelRow, facility: code, what: 'Changed', detail: diff.map(([k]) => k).join(', '), amount: line.amount });
    } else {
      if (!fac.editable) {
        err(fac.reason ?? 'This facility can’t be changed');
        continue;
      }
      bucket(fac.id).lines.push(line);
      changes.push({ excelRow: u.excelRow, facility: code, what: 'New', detail: `${glOf(line.workType, line.element)} ${line.workType} ${line.description ?? elementLabel(line.element)}`, amount: line.amount });
    }
  }
  return { saves, changes, errors };
}
