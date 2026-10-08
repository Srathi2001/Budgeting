// Excel input templates for the cell-based input pages (Other Income, Building / Admin overheads, FM
// labour): download, fill in Excel, upload.
//
// A template is one or more sheets of rows. Each row has a hidden key (column A) that says what it is;
// label and reference columns are locked and grey; input columns are white where the user may type.
// Optional blank rows at the bottom take new rows, identified by their identity columns. On upload the
// input cells are compared with the tool and the differences go through the page's own save path.
import ExcelJS from 'exceljs';
import { XL } from '@/lib/format';

export type CellKind = 'text' | 'money' | 'number' | 'int' | 'pct' | 'month';
export type CellValue = string | number | null;

export interface TplCol {
  key: string;
  header: string;
  width: number;
  kind: CellKind;
  /** input column (white where the row opens it) */
  input?: boolean;
  /** identifies a new row (input on the blank rows only) */
  identity?: boolean;
  /** drop-down values */
  list?: readonly string[];
  /** part of the row's name in the upload preview */
  label?: boolean;
  help?: string;
}
export interface TplRow {
  key: string;
  values: Record<string, CellValue>;
  /** the input columns this row lets the user change */
  open: string[];
}
export interface TplSheet {
  name: string;
  columns: TplCol[];
  rows: TplRow[];
  /** blank rows for new entries; `keyOf` builds the key from the identity values (null: not identified) */
  newRows?: number;
  keyOf?: (values: Record<string, unknown>, excelRow: number) => string | null;
}
export interface Template {
  title: string;
  /** what it covers, e.g. "45 properties" */
  scope: string;
  instructions: string[];
  sheets: TplSheet[];
  locked: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KEY = 'Key';
const HEADER_ROW = 2;
const PASSWORD = 'budget-template';
const FILL = {
  fixed: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } } as ExcelJS.Fill,
  input: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } } as ExcelJS.Fill,
  inputHead: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CC' } } as ExcelJS.Fill,
  head: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F1F1F' } } as ExcelJS.Fill,
};
const THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } } as ExcelJS.Border;
const BOX = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const FMT: Record<CellKind, string | undefined> = { text: undefined, money: XL.amount, number: '#,##0.##', int: XL.count, pct: XL.pct, month: undefined };

const show = (kind: CellKind, v: CellValue) => (kind === 'month' && typeof v === 'number' ? MONTHS[v - 1] : v);

export async function buildTemplate(t: Template, ctx: { versionName: string; user: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Budget';
  wb.created = new Date();

  // ---- instructions
  const info = wb.addWorksheet('Instructions', { properties: { tabColor: { argb: 'FF1F1F1F' } } });
  info.columns = [{ width: 26 }, { width: 12 }, { width: 100 }];
  const line = (text: string, bold = false, size = 11) => {
    const r = info.addRow([text]);
    r.font = { bold, size };
    info.mergeCells(r.number, 1, r.number, 3);
    r.alignment = { wrapText: true, vertical: 'top' };
  };
  line(`${t.title} input template · ${ctx.versionName}`, true, 14);
  line(`${t.scope} · downloaded ${new Date().toISOString().slice(0, 10)} by ${ctx.user}`);
  info.addRow([]);
  line('What to do', true, 12);
  [
    `1. Fill in the white cells only. Grey cells come from the tool (actuals, calculated values, or fields you can’t change) and the sheets are protected.`,
    '2. A white cell left blank means “nothing entered”.',
    '3. Don’t add, delete or reorder rows or columns, and don’t change the hidden Key column.',
    ...t.instructions,
    `Save the file as .xlsx and upload it on the same page: Import Excel. You see every change before it is applied; the upload follows the same rules as typing in the tool.`,
  ].forEach((s) => line(s));
  if (t.locked) line('This budget version is locked: the template is for reference only.', true);
  for (const s of t.sheets) {
    info.addRow([]);
    line(t.sheets.length > 1 ? `Columns · ${s.name}` : 'Columns', true, 12);
    const h = info.addRow(['Column', 'Type', 'What to enter']);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.eachCell((c) => (c.fill = FILL.head));
    for (const c of s.columns) {
      const r = info.addRow([c.header, c.input ? 'Input' : c.identity ? 'New rows' : 'Fixed', c.help ?? (c.input ? '' : 'From the tool.')]);
      r.alignment = { wrapText: true, vertical: 'top' };
      r.getCell(2).fill = c.input || c.identity ? FILL.inputHead : FILL.fixed;
      r.eachCell((cell) => (cell.border = BOX));
    }
  }

  // ---- drop-down lists (hidden)
  const ls = wb.addWorksheet('Lists', { state: 'hidden' });
  const ranges = new Map<string, string>();
  let li = 0;
  const listRange = (vals: readonly string[]) => {
    const k = vals.join('\u0001');
    if (!ranges.has(k)) {
      const col = ls.getColumn(++li).letter;
      vals.forEach((v, j) => (ls.getCell(`${col}${j + 1}`).value = v));
      ranges.set(k, `Lists!$${col}$1:$${col}$${Math.max(vals.length, 1)}`);
    }
    return ranges.get(k)!;
  };

  // ---- data sheets
  for (const s of t.sheets) {
    const cols: TplCol[] = [{ key: '__key', header: KEY, width: 4, kind: 'text' }, ...s.columns];
    const ws = wb.addWorksheet(s.name.slice(0, 31), { views: [{ state: 'frozen', xSplit: 1 + s.columns.filter((c) => c.label).length, ySplit: HEADER_ROW }] });
    ws.columns = cols.map((c) => ({ width: c.width }));
    ws.getColumn(1).hidden = true;
    const band = ws.getRow(1);
    const names = ws.getRow(HEADER_ROW);
    cols.forEach((c, i) => {
      const b = band.getCell(i + 1);
      b.value = c.input ? 'Input' : c.identity ? 'New rows' : i ? 'Fixed' : '';
      b.font = { bold: true, size: 9, color: { argb: c.input || c.identity ? 'FF7A5B00' : 'FF595959' } };
      b.fill = c.input || c.identity ? FILL.inputHead : FILL.fixed;
      const n = names.getCell(i + 1);
      n.value = c.header;
      n.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      n.fill = FILL.head;
      n.alignment = { wrapText: true, vertical: 'middle' };
    });
    names.height = 32;
    const style = (row: ExcelJS.Row, isOpen: (c: TplCol) => boolean) =>
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        const open = !t.locked && isOpen(c);
        cell.protection = { locked: !open };
        cell.fill = open ? FILL.input : FILL.fixed;
        cell.border = BOX;
        if (FMT[c.kind]) cell.numFmt = FMT[c.kind]!;
        if (!open) return;
        const list = c.kind === 'month' ? MONTHS : c.list;
        if (list) cell.dataValidation = { type: 'list', allowBlank: true, formulae: [listRange(list)], showErrorMessage: true, error: 'Choose from the list' };
        else if (c.kind !== 'text')
          cell.dataValidation = {
            type: c.kind === 'int' ? 'whole' : 'decimal',
            operator: c.kind === 'pct' ? 'between' : 'greaterThanOrEqual',
            allowBlank: true,
            formulae: c.kind === 'pct' ? [0, 1] : [c.kind === 'money' ? -1e11 : 0],
            showErrorMessage: true,
            error: c.kind === 'pct' ? 'A percentage 0–100%' : 'A number',
          };
      });
    for (const r of s.rows) {
      const row = ws.addRow([r.key, ...s.columns.map((c) => show(c.kind, r.values[c.key] ?? null))]);
      style(row, (c) => !!c.input && r.open.includes(c.key));
    }
    if (!t.locked) for (let i = 0; i < (s.newRows ?? 0); i++) style(ws.addRow([]), (c) => !!c.input || !!c.identity);
    ws.autoFilter = { from: { row: HEADER_ROW, column: 2 }, to: { row: HEADER_ROW, column: cols.length } };
    await ws.protect(PASSWORD, { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, autoFilter: true, sort: false });
  }
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

/** a typed value: number / month / text, or 'bad' */
function parse(kind: CellKind, v: unknown, list?: readonly string[]): CellValue | 'bad' {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  if (kind === 'month') {
    if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 12 ? v : 'bad';
    const i = MONTHS.findIndex((m) => String(v).trim().toLowerCase().startsWith(m.toLowerCase()));
    return i >= 0 ? i + 1 : 'bad';
  }
  if (kind === 'text') {
    const s = String(v).trim();
    if (!list) return s;
    return list.find((x) => x.toLowerCase() === s.toLowerCase()) ?? 'bad';
  }
  let n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '-$1').replace(/%$/, ''));
  if (typeof v === 'string' && kind === 'pct' && /%\s*$/.test(v)) n /= 100;
  if (!Number.isFinite(n)) return 'bad';
  if (kind === 'int' && !Number.isInteger(n)) return 'bad';
  return Math.round(n * (kind === 'pct' ? 1e6 : kind === 'number' ? 1e4 : 100)) / (kind === 'pct' ? 1e6 : kind === 'number' ? 1e4 : 100);
}

export interface TemplateChange {
  excelRow: number;
  sheet: string;
  key: string;
  /** the row's name, e.g. "30B101 · Water charges" */
  row: string;
  column: string;
  header: string;
  from: CellValue;
  to: CellValue;
}
export interface TemplateError {
  excelRow: number;
  sheet: string;
  row: string;
  message: string;
}

const same = (a: CellValue, b: CellValue) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : (a ?? null) === (b ?? null));
const nameOf = (s: TplSheet, values: Record<string, unknown>) =>
  s.columns
    .filter((c) => c.label)
    .map((c) => values[c.key])
    .filter((v) => v !== null && v !== undefined && v !== '')
    .join(' · ');

/** Reads an uploaded template and compares its input cells with `current` (the same template built now). */
export async function diffTemplate(data: ArrayBuffer, current: Template): Promise<{ changes: TemplateChange[]; errors: TemplateError[]; error?: string }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    return { changes: [], errors: [], error: 'Not an Excel (.xlsx) file' };
  }
  const changes: TemplateChange[] = [];
  const errors: TemplateError[] = [];
  let found = 0;
  for (const s of current.sheets) {
    const ws = wb.getWorksheet(s.name.slice(0, 31));
    if (!ws) continue;
    found++;
    const at = new Map<string, number>();
    ws.getRow(HEADER_ROW).eachCell((cell, n) => {
      const h = String(cell.value ?? '').trim();
      if (h === KEY) at.set('__key', n);
      const c = s.columns.find((x) => x.header === h);
      if (c) at.set(c.key, n);
    });
    if (!at.has('__key')) return { changes: [], errors: [], error: `The ${s.name} sheet has no Key column: upload the template downloaded from the tool` };
    const rows = new Map(s.rows.map((r) => [r.key, r]));
    const seen = new Set<string>();
    ws.eachRow((row, n) => {
      if (n <= HEADER_ROW) return;
      const raw: Record<string, unknown> = {};
      for (const c of s.columns) if (at.has(c.key)) raw[c.key] = cellValue(row.getCell(at.get(c.key)!).value);
      const given = cellValue(row.getCell(at.get('__key')!).value);
      const inputs = s.columns.filter((c) => c.input);
      if (given === null && [...s.columns.filter((c) => c.identity), ...inputs].every((c) => raw[c.key] === null || raw[c.key] === undefined)) return;
      let key = given === null ? null : String(given);
      if (key === null) {
        key = s.keyOf?.(raw, n) ?? null;
        if (!key) {
          errors.push({ excelRow: n, sheet: s.name, row: nameOf(s, raw) || 'New row', message: `Fill in ${s.columns.filter((c) => c.identity).map((c) => c.header).join(' and ')}` });
          return;
        }
      }
      if (seen.has(key)) {
        errors.push({ excelRow: n, sheet: s.name, row: nameOf(s, raw), message: 'This line appears twice; the first one is used' });
        return;
      }
      seen.add(key);
      const cur = rows.get(key);
      if (!cur && given !== null) {
        errors.push({ excelRow: n, sheet: s.name, row: nameOf(s, raw), message: 'Line not in this budget (or not visible to you)' });
        return;
      }
      const label = cur ? nameOf(s, cur.values) : nameOf(s, raw);
      for (const c of inputs) {
        if (!at.has(c.key)) continue;
        const v = parse(c.kind, raw[c.key], c.list);
        if (v === 'bad') {
          errors.push({ excelRow: n, sheet: s.name, row: label, message: `${c.header}: can’t read “${String(raw[c.key])}”` });
          continue;
        }
        const before = cur?.values[c.key] ?? null;
        if (same(before, v)) continue;
        // a new row may fill any input; an existing row only what it opens
        if (cur && !cur.open.includes(c.key)) {
          errors.push({ excelRow: n, sheet: s.name, row: label, message: `${c.header} is fixed on this line` });
          continue;
        }
        changes.push({ excelRow: n, sheet: s.name, key, row: label, column: c.key, header: c.header, from: before, to: v });
      }
    });
  }
  if (!found) return { changes: [], errors: [], error: `No ${current.sheets.map((s) => `“${s.name}”`).join(' or ')} sheet: upload the ${current.title} template downloaded from the tool` };
  return { changes, errors };
}

/** a template value as the page shows it */
export const showValue = (v: CellValue, column?: string) =>
  v === null ? '—' : typeof v === 'number' ? (column && /pct/i.test(column) ? `${Math.round(v * 1000) / 10}%` : v.toLocaleString('en-US', { maximumFractionDigits: 2 })) : v;
