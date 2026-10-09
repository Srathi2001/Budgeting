// The Admin Overheads template's detail sheets: one per back-up schedule (vehicles, telephones, training,
// staff welfare, IT equipment, office capex, other items), as the tool's tabs. Each line is one item; the
// Overview's cells of the accounts with a schedule add up these sheets (SUMIFS), so a change here shows
// there at once. On upload each changed or new line is saved as an item, with the tool's own checks.
import { ADMIN_ACCOUNT, ADMIN_ACCOUNTS, DEPTS, PAYERS, deptName, isPayrollAccount } from '@/lib/budget/admin-types';
import { ITEM_KINDS, ITEM_KIND, PHONE_LINES, SCHEDULE_ACCOUNT, type AdminItem, type FieldSpec, type ItemData, type ItemKind } from '@/lib/budget/admin-items';
import { FIRST_ROW, columnOf, type CellValue, type TemplateChange, type TplCol, type TplSheet } from './cell-template';

const NEW_ROWS = 40;
const deptText = (code: string) => `${code} ${deptName(code)}`;
const payerText = (code: string) => `${code} ${PAYERS.find((p) => p.code === code)?.name ?? ''}`.trim();
const acctText = (code: string) => `${code} ${ADMIN_ACCOUNT.get(code)?.name ?? ''}`.trim();
const code = (v: unknown, digits: number) => new RegExp(`^\\d{${digits}}`).exec(String(v ?? '').trim())?.[0] ?? null;

/** departments budgeted in Admin overheads (attendees, owners) */
const OWN_DEPTS = DEPTS.filter((d) => !d.elsewhere);
/** accounts the other items may post to: admin overheads without a schedule of their own */
const OTHER_ACCOUNTS = ADMIN_ACCOUNTS.filter((a) => !isPayrollAccount(a.code) && !SCHEDULE_ACCOUNT.has(a.code));

export const itemSheetName = (kind: ItemKind) => ITEM_KIND.get(kind)!.label;

function fieldColumns(f: FieldSpec): TplCol[] {
  const help = [f.required ? 'Required.' : '', f.hint ? `${f.hint[0].toUpperCase()}${f.hint.slice(1)}.` : ''].filter(Boolean).join(' ') || undefined;
  switch (f.type) {
    case 'paxByDept':
      return OWN_DEPTS.map((d) => ({ key: `pax_${d.code}`, header: `Attendees ${d.code} ${d.name}`, width: 11, kind: 'int' as const, input: true, help: `Attendees from ${d.name}: it is charged attendees × cost.` }));
    case 'amount':
      return [{ key: f.key, header: f.label, width: 13, kind: 'money', input: true, help: help ?? 'For the year.' }];
    case 'int':
      return [{ key: f.key, header: f.label, width: 10, kind: 'int', input: true, help }];
    case 'month':
      return [{ key: f.key, header: f.label, width: 9, kind: 'month', input: true, help }];
    case 'select':
      return [{ key: f.key, header: f.label, width: 18, kind: 'text', input: true, list: f.options, help }];
    case 'account':
      return [{ key: f.key, header: f.label, width: 36, kind: 'text', input: true, list: OTHER_ACCOUNTS.map((a) => acctText(a.code)), help }];
    default:
      return [{ key: f.key, header: f.label, width: f.wide ? 34 : 18, kind: 'text', input: true, help }];
  }
}

/** the year total of a line, as an Excel formula of its own cells */
function totalFormula(kind: ItemKind, s: Pick<TplSheet, 'columns'>): string {
  const spec = ITEM_KIND.get(kind)!;
  const cell = (key: string) => `${columnOf(s, key)}{r}`;
  const amounts = spec.fields.filter((f) => f.type === 'amount').map((f) => cell(f.key));
  if (kind === 'phone') return `N(${cell('monthly')})*12`;
  if (kind === 'training') return `N(${cell('costPerPax')})*SUM(${cell(`pax_${OWN_DEPTS[0].code}`)}:${cell(`pax_${OWN_DEPTS.at(-1)!.code}`)})`;
  return `SUM(${amounts.join(',')})`;
}

const itemValues = (kind: ItemKind, it: AdminItem): Record<string, CellValue> => {
  const out: Record<string, CellValue> = { dept: deptText(it.dept), payer: payerText(it.payer) };
  for (const f of ITEM_KIND.get(kind)!.fields) {
    const v = it.data[f.key];
    if (f.type === 'paxByDept') for (const d of OWN_DEPTS) out[`pax_${d.code}`] = ((v ?? {}) as Record<string, number>)[d.code] ?? null;
    else if (f.type === 'account') out[f.key] = typeof v === 'string' ? acctText(v) : null;
    else out[f.key] = typeof v === 'object' ? null : (v ?? null);
  }
  return out;
};

/** One detail sheet per schedule; existing items first, then blank lines for new ones. */
export function itemSheets(items: AdminItem[], locked: boolean): TplSheet[] {
  return ITEM_KINDS.map((spec) => {
    const columns: TplCol[] = [
      { key: 'dept', header: 'Department', width: 30, kind: 'text', label: true, identity: true, list: OWN_DEPTS.map((d) => deptText(d.code)), help: 'New lines: the department that owns it (drop-down).' },
      { key: 'payer', header: 'Paid by', width: 16, kind: 'text', identity: true, list: PAYERS.map((p) => payerText(p.code)), help: 'New lines: the company that pays it (drop-down).' },
      ...spec.fields.flatMap(fieldColumns),
      { key: 'total', header: 'Total (year)', width: 14, kind: 'money', help: 'Calculated: what the line posts for the year.' },
    ];
    const sheet: TplSheet = {
      name: itemSheetName(spec.kind),
      columns,
      rows: [],
      newRows: locked ? 0 : NEW_ROWS,
      keyOf: (v, n) => {
        const dept = code(v.dept, 3);
        const payer = code(v.payer, 3);
        return dept && payer ? `new|${spec.kind}|${n}|${dept}|${payer}` : null;
      },
    };
    sheet.rowFormulas = { total: totalFormula(spec.kind, sheet) };
    sheet.rows = items
      .filter((i) => i.kind === spec.kind)
      .map((it) => {
        const values = itemValues(spec.kind, it);
        values.total = spec.postings(it.data, it.dept).reduce((s, p) => s + p.amount, 0);
        return { key: `itm|${spec.kind}|${it.id}`, values, open: columns.filter((c) => c.input).map((c) => c.key) };
      });
    return sheet;
  });
}

/** the last row a detail sheet can use */
const lastRow = (s: TplSheet) => FIRST_ROW + s.rows.length + (s.newRows ?? 0);

/**
 * The Overview's cell of an account with a schedule, as a formula over its detail sheet: what the items
 * of department `dept` paid by `payer` post to `account`. Null when the account has no schedule.
 */
export function scheduleFormula(sheets: TplSheet[], account: string, dept: string, payer: string): string | null {
  const kind = SCHEDULE_ACCOUNT.get(account);
  // FM and security are budgeted elsewhere: no items
  if (!kind || !OWN_DEPTS.some((d) => d.code === dept)) return null;
  const s = sheets.find((x) => x.name === itemSheetName(kind))!;
  const range = (key: string) => {
    const c = columnOf(s, key);
    return `'${s.name}'!$${c}$${FIRST_ROW}:$${c}$${lastRow(s)}`;
  };
  const who = `${range('dept')},"${dept}*",${range('payer')},"${payer}*"`;
  if (kind === 'vehicle') {
    const f = ITEM_KIND.get('vehicle')!.fields.find((x) => x.account === account)!;
    return `SUMIFS(${range(f.key)},${who})`;
  }
  if (kind === 'phone') return `SUMIFS(${range('total')},${who},${range('line')},"${PHONE_LINES.find((l) => l.account === account)!.label}")`;
  if (kind === 'event') return `SUMIFS(${range('amount')},${who})`;
  // training: each department is charged its attendees × the cost, whoever owns the line
  return `SUMPRODUCT((LEFT(${range('payer')},3)="${payer}")*${range('costPerPax')}*${range(`pax_${dept}`)})`;
}

/** an item's data from its sheet values */
function itemData(kind: ItemKind, values: Record<string, CellValue>): ItemData {
  const out: ItemData = {};
  for (const f of ITEM_KIND.get(kind)!.fields) {
    if (f.type === 'paxByDept') {
      const pax: Record<string, number> = {};
      for (const d of OWN_DEPTS) {
        const v = values[`pax_${d.code}`];
        if (typeof v === 'number' && v > 0) pax[d.code] = v;
      }
      out[f.key] = pax;
    } else if (f.type === 'account') out[f.key] = code(values[f.key], 5);
    else out[f.key] = values[f.key] ?? null;
  }
  return out;
}

/** The items an upload adds or changes: existing ones keep what was not changed. */
export function itemsFromChanges(sheets: TplSheet[], items: AdminItem[], changes: TemplateChange[]) {
  const byKey = new Map<string, TemplateChange[]>();
  for (const c of changes) if (c.key.startsWith('itm|') || c.key.startsWith('new|')) byKey.set(c.key, [...(byKey.get(c.key) ?? []), c]);
  return [...byKey].map(([key, cs]) => {
    const parts = key.split('|');
    const kind = parts[1] as ItemKind;
    const row = key.startsWith('itm|') ? sheets.find((s) => s.name === itemSheetName(kind))?.rows.find((r) => r.key === key) : undefined;
    const values: Record<string, CellValue> = { ...(row?.values ?? {}) };
    for (const c of cs) values[c.column] = c.to;
    const it = row ? items.find((i) => i.id === Number(parts[2])) : undefined;
    return {
      label: `${cs[0].sheet} row ${cs[0].excelRow}`,
      item: { id: it?.id ?? null, kind, dept: it?.dept ?? parts[3], payer: it?.payer ?? parts[4], data: itemData(kind, values) },
    };
  });
}
