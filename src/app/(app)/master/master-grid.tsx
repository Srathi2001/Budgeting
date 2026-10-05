'use client';

import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  colorSchemeDark,
  themeQuartz,
  type CellClassParams,
  type CellValueChangedEvent,
  type ColDef,
  type ColGroupDef,
  type EditableCallbackParams,
  type GetRowIdParams,
  type GridApi,
  type GridReadyEvent,
  type RowClassParams,
  type SelectionChangedEvent,
  type ValueFormatterParams,
  type ValueGetterParams,
  type ValueSetterParams,
} from 'ag-grid-community';
import type { MasterRow, RowPatch } from '@/lib/budget/master-types';
import { fmt, MONTHS, pct } from '@/lib/format';
import { saveLines, addUnit, removeLine } from './actions';
import { ScheduleEditor } from './schedule-editor';

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withPart(colorSchemeDark).withParams({
  fontFamily: 'inherit',
  fontSize: 12,
  rowHeight: 28,
  headerHeight: 30,
  spacing: 5,
  backgroundColor: '#121821',
  foregroundColor: '#c3ccd7',
  chromeBackgroundColor: '#15233a',
  headerBackgroundColor: '#15233a',
  headerTextColor: '#a9c7f5',
  headerFontWeight: 600,
  borderColor: '#263241',
  columnBorder: true,
  headerColumnBorder: true,
  oddRowBackgroundColor: '#131b25',
  rowHoverColor: '#18263a',
  selectedRowBackgroundColor: '#1a2c47',
  accentColor: '#3b82f6',
  wrapperBorderRadius: 8,
});

type Row = MasterRow;
type P = { id: number; code: string; name: string; editable: boolean };

// ---------- value helpers ----------------------------------------------------------------------

const ymdToDmy = (v: unknown) => {
  if (typeof v !== 'string' || !v) return '';
  const [y, m, d] = v.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

/** Accepts dd/mm/yyyy, d-m-yyyy or yyyy-mm-dd; returns yyyy-mm-dd or null. */
function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const yn = (b: boolean | null | undefined) => (b === true ? 'Y' : b === false ? 'N' : '');
const fromYn = (v: unknown): boolean | null => (v === 'Y' ? true : v === 'N' ? false : null);

const editable = (p: EditableCallbackParams<Row>) => !!p.data?.editable && !p.node.isRowPinned();
const inputClass = (p: CellClassParams<Row>) => (p.data?.editable && !p.node.isRowPinned() ? 'cell-input' : '');
const money = (p: ValueFormatterParams) => fmt(p.value as number | null);
const money2 = (p: ValueFormatterParams) => fmt(p.value as number | null, 2);

/** Read-only fact from Oracle Fusion. */
function fusionCol(field: keyof Row, headerName: string, kind: 'text' | 'money' | 'date' = 'text', extra: Partial<ColDef<Row>> = {}): ColDef<Row> {
  return {
    colId: field as string,
    field,
    headerName,
    headerClass: 'hdr-fusion',
    cellClass: 'cell-fusion',
    editable: false,
    cellDataType: false,
    filter: kind === 'text',
    ...(kind === 'money' ? { type: 'rightAligned', valueFormatter: money } : {}),
    ...(kind === 'date' ? { valueFormatter: (p: ValueFormatterParams) => ymdToDmy(p.value) } : {}),
    ...extra,
  };
}

/** Column for a field that holds a PM override; blank override shows the engine's derived value. */
function overrideCol(field: keyof Row, derived: (r: Row) => unknown, kind: 'money' | 'date' | 'yn', headerName: string): ColDef<Row> {
  return {
    colId: field as string,
    headerName,
    headerClass: 'hdr-input',
    editable,
    headerTooltip: 'Blank = calculated (grey). Type a value to override (amber). Delete to revert.',
    valueGetter: (p: ValueGetterParams<Row>) => {
      if (!p.data) return null;
      const o = p.data[field];
      const v = o ?? derived(p.data);
      return kind === 'yn' ? yn(v as boolean | null) : v;
    },
    valueSetter: (p: ValueSetterParams<Row>) => {
      const v = kind === 'money' ? parseNum(p.newValue) : kind === 'date' ? parseDate(p.newValue) : fromYn(p.newValue);
      (p.data as unknown as Record<string, unknown>)[field as string] = v;
      return true;
    },
    valueFormatter: kind === 'money' ? money : kind === 'date' ? (p) => ymdToDmy(p.value) : undefined,
    cellDataType: false,
    ...(kind === 'yn' ? { cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['', 'Y', 'N'] } } : {}),
    ...(kind === 'date' ? { cellEditor: 'agTextCellEditor' } : {}),
    type: kind === 'money' ? 'rightAligned' : undefined,
    cellClass: (p) => (p.node.isRowPinned() ? '' : p.data?.[field] !== null && p.data?.[field] !== undefined ? 'cell-override' : 'cell-derived'),
  };
}

function inputCol(field: keyof Row, headerName: string, kind: 'text' | 'money' | 'int' | 'yn' | 'ynReq', extra: Partial<ColDef<Row>> = {}): ColDef<Row> {
  const base: ColDef<Row> = { colId: field as string, field, headerName, headerClass: 'hdr-input', editable, cellClass: inputClass, cellDataType: false };
  switch (kind) {
    case 'money':
    case 'int':
      return {
        ...base,
        type: 'rightAligned',
        valueFormatter: money,
        valueParser: (p) => {
          const n = parseNum(p.newValue);
          return kind === 'int' && n !== null ? Math.round(n) : n;
        },
        ...extra,
      };
    case 'yn':
    case 'ynReq':
      return {
        ...base,
        valueGetter: (p) => (p.data ? yn(p.data[field] as boolean | null) : ''),
        valueSetter: (p) => {
          const v = fromYn(p.newValue);
          (p.data as unknown as Record<string, unknown>)[field as string] = kind === 'ynReq' ? v === true : v;
          return true;
        },
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: kind === 'ynReq' ? ['Y', 'N'] : ['', 'Y', 'N'] },
        ...extra,
      };
    default:
      return { ...base, valueParser: (p) => (p.newValue === '' ? null : p.newValue), ...extra };
  }
}

/** Unit master column; editable fields are marked as inputs. */
function unitCol(field: keyof Row, headerName: string, opts: { edit?: 'text' | 'money' | 'int'; money?: boolean } & Partial<ColDef<Row>> = {}): ColDef<Row> {
  const { edit, money: isMoney, ...extra } = opts;
  if (edit) return { ...inputCol(field, headerName, edit === 'text' ? 'text' : edit, extra), headerClass: 'hdr-unit' };
  return {
    colId: field as string,
    field,
    headerName,
    headerClass: 'hdr-unit',
    cellDataType: false,
    filter: !isMoney,
    ...(isMoney ? { type: 'rightAligned', valueFormatter: money } : {}),
    ...extra,
  };
}

function derivedCol(colId: string, headerName: string, get: (r: Row) => unknown, fmtKind: 'money' | 'money2' | 'pct' | 'text', headerTooltip?: string): ColDef<Row> {
  return {
    colId,
    headerName,
    headerClass: 'hdr-rera',
    headerTooltip,
    cellClass: 'cell-derived',
    type: fmtKind === 'text' ? undefined : 'rightAligned',
    valueGetter: (p) => (p.data && !p.node?.isRowPinned() ? get(p.data) : null),
    valueFormatter:
      fmtKind === 'money' ? money : fmtKind === 'money2' ? money2 : fmtKind === 'pct' ? (p) => (p.value === null || p.value === undefined ? '' : pct(p.value as number)) : undefined,
  };
}

function monthCols(key: 'revenue' | 'cashFlow', totalKey: 'revenueTotal' | 'cashFlowTotal', hdr: string): ColDef<Row>[] {
  return [
    ...MONTHS.map(
      (m, i): ColDef<Row> => ({
        colId: `${key}_${i}`,
        headerName: m,
        headerClass: hdr,
        type: 'rightAligned',
        cellClass: `cell-month${i === 0 ? ' group-start' : ''}`,
        valueGetter: (p) => p.data?.[key]?.[i] ?? 0,
        valueFormatter: money,
      }),
    ),
    {
      colId: totalKey,
      headerName: 'Total',
      headerClass: hdr,
      type: 'rightAligned',
      cellClass: 'cell-month font-semibold group-start',
      valueGetter: (p) => p.data?.[totalKey] ?? 0,
      valueFormatter: money,
    },
  ];
}

const psf = (rent: number | null | undefined, area: number | null) => (rent && area ? rent / area : null);

// ---------- component --------------------------------------------------------------------------

export function MasterGrid({
  versionId,
  year,
  locked,
  staffDiscount,
  rows,
  properties,
  selectedProperty,
}: {
  versionId: number;
  year: number;
  locked: boolean;
  staffDiscount: number;
  rows: Row[];
  properties: P[];
  selectedProperty: number | null;
}) {
  const router = useRouter();
  const apiRef = useRef<GridApi<Row> | null>(null);
  const queue = useRef(new Map<number, RowPatch>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ kind: 'idle' });
  const [errors, setErrors] = useState<string[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [showRevenue, setShowRevenue] = useState(true);
  const [showCash, setShowCash] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [adding, setAdding] = useState(false);
  const [, startNav] = useTransition();

  const refreshTotals = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const t = { revenue: Array(12).fill(0), cashFlow: Array(12).fill(0), revenueTotal: 0, cashFlowTotal: 0, currentRent: 0, count: 0 };
    api.forEachNodeAfterFilter((n) => {
      if (!n.data) return;
      t.count++;
      t.currentRent += n.data.currentRent ?? 0;
      n.data.revenue.forEach((v, i) => (t.revenue[i] += v));
      n.data.cashFlow.forEach((v, i) => (t.cashFlow[i] += v));
      t.revenueTotal += n.data.revenueTotal;
      t.cashFlowTotal += n.data.cashFlowTotal;
    });
    api.setGridOption('pinnedBottomRowData', [
      {
        unitCode: `Total · ${t.count} units`,
        currentRent: t.currentRent,
        revenue: t.revenue,
        cashFlow: t.cashFlow,
        revenueTotal: t.revenueTotal,
        cashFlowTotal: t.cashFlowTotal,
        warnings: [],
        editable: false,
      } as unknown as Row,
    ]);
  }, []);

  const flush = useCallback(async () => {
    const changes = [...queue.current.entries()].map(([lineId, patch]) => ({ lineId, patch }));
    queue.current.clear();
    if (!changes.length) return;
    setStatus({ kind: 'saving' });
    try {
      const res = await saveLines(versionId, changes);
      apiRef.current?.applyTransaction({ update: res.rows });
      setSelected((s) => (s ? (res.rows.find((r) => r.lineId === s.lineId) ?? s) : s));
      refreshTotals();
      if (res.errors.length) {
        setErrors(res.errors.map((e) => `${res.rows.find((r) => r.lineId === e.lineId)?.unitCode ?? e.lineId}: ${e.message}`));
        setStatus({ kind: 'error', text: `${res.errors.length} change(s) rejected` });
      } else {
        setErrors([]);
        setStatus({ kind: 'saved', text: `Saved ${changes.length} row(s) · recalculated` });
      }
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message });
    }
  }, [versionId, refreshTotals]);

  const onCellValueChanged = useCallback(
    (e: CellValueChangedEvent<Row>) => {
      const field = e.column.getColId() as keyof RowPatch;
      if (!e.data) return;
      const patch = queue.current.get(e.data.lineId) ?? {};
      (patch as Record<string, unknown>)[field] = (e.data as unknown as Record<string, unknown>)[field];
      queue.current.set(e.data.lineId, patch);
      setStatus({ kind: 'saving', text: 'Unsaved changes…' });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 600);
    },
    [flush],
  );

  const columnDefs = useMemo<(ColDef<Row> | ColGroupDef<Row>)[]>(() => {
    const defs: (ColDef<Row> | ColGroupDef<Row>)[] = [
      {
        headerName: 'Unit',
        headerClass: 'hdr-unit',
        children: [
          { colId: 'propertyName', field: 'propertyName', headerName: 'Property', headerClass: 'hdr-unit', pinned: 'left', filter: true, maxWidth: 220 },
          {
            colId: 'unitCode',
            field: 'unitCode',
            headerName: 'Unit Code',
            headerClass: 'hdr-unit',
            pinned: 'left',
            filter: true,
            cellClass: (p) => (p.node.isRowPinned() ? 'font-semibold' : ''),
          },
          {
            colId: 'issues',
            headerName: 'Issues',
            headerClass: 'hdr-unit',
            headerTooltip: 'Number of warnings on the row (hover a number to read them). Blank = no issues.',
            pinned: 'left',
            valueGetter: (p) => (p.data?.warnings?.length ? p.data.warnings.length : ''),
            tooltipValueGetter: (p) => p.data?.warnings?.join('\n') || undefined,
            cellClass: 'cell-issue',
          },
        ],
      },
      {
        headerName: 'Unit master',
        headerClass: 'hdr-unit',
        children: [
          unitCol('buName', 'Reference sheet', { valueGetter: (p) => (p.data && !p.node?.isRowPinned() ? `Revenue Budget_${p.data.buName}` : null) }),
          unitCol('buCode', 'BU'),
          unitCol('propertyCode', 'Property Code'),
          unitCol('coordinator', 'PC'),
          unitCol('bedroom', 'Bedroom / Code', { edit: 'text' }),
          unitCol('area', 'Area (sq.ft)', { edit: 'money' }),
          { ...unitCol('rc', 'Type (R/C)', { edit: 'text' }), cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['R', 'C', 'L'] }, filter: true },
          { ...inputCol('mfCurrent', 'MF (Y/N)', 'yn'), headerClass: 'hdr-unit' },
          unitCol('mergedUnitNumber', 'Merged Unit No.'),
          unitCol('unitStatus', 'Unit Status'),
          unitCol('unitType', 'Unit Type', { edit: 'text', filter: true }),
          unitCol('resiCommercial', 'Resi / Commercial (Fusion)'),
          unitCol('landlord', 'Landlord', { edit: 'text' }),
          unitCol('pivotCategory', 'Category', { edit: 'text', filter: true }),
          unitCol('rooms', 'Rooms', { edit: 'int' }),
          unitCol('capacity', 'Capacity', { edit: 'int' }),
        ],
      },
      {
        headerName: 'Current lease · Oracle Fusion (read-only)',
        headerClass: 'hdr-fusion',
        children: [
          fusionCol('leaseNumber', 'Lease Number'),
          fusionCol('leaseVersion', 'Version'),
          fusionCol('tenantCode', 'Tenant Code'),
          fusionCol('tenant', 'Tenant Name', 'text', { maxWidth: 260 }),
          fusionCol('customerClass', 'Customer Class'),
          fusionCol('currentStart', 'Lease Start', 'date'),
          fusionCol('rentStart', 'Rent Start', 'date'),
          fusionCol('currentEnd', 'Lease End', 'date'),
          fusionCol('currentRent', 'Actual Lease Amount', 'money'),
          fusionCol('vatAmount', 'VAT', 'money'),
          fusionCol('securityDeposit', 'Security Deposit', 'money'),
          fusionCol('leaseStatus', 'Lease Status'),
          fusionCol('leaseRemarks', 'Lease Remarks', 'text', { maxWidth: 280, tooltipField: 'leaseRemarks' }),
          { ...fusionCol('vacant', 'Vacant'), valueGetter: (p) => (p.data && !p.node?.isRowPinned() ? yn(p.data.vacant) : null) },
        ],
      },
      {
        headerName: 'Budget inputs',
        headerClass: 'hdr-input',
        children: [
          {
            ...inputCol('staffOwner', 'Staff / Owner', 'text'),
            cellEditor: 'agSelectCellEditor',
            cellEditorParams: { values: ['', 'STAFF', 'OWNER'] },
            valueParser: (p) => (p.newValue ? p.newValue : null),
          },
          inputCol('renew1', 'Renew (Y/N)', 'ynReq', { headerTooltip: 'Y = tenant renews (RERA increase). N = new tenant after the vacancy gap, at the budget rate.' }),
          inputCol('noRenewal', 'Not re-let', 'ynReq', { headerTooltip: 'Y = unit is not let again after the current lease' }),
          inputCol('budgetRate', 'Budget Rate', 'money', {
            headerTooltip: 'New-tenant rate. Residential: annual rent · Commercial/labour: AED per sq.ft per year · Camps: AED per bed per month',
          }),
          {
            colId: 'increasePctOverride',
            headerName: 'Increase %',
            headerClass: 'hdr-input',
            editable,
            type: 'rightAligned',
            headerTooltip: 'Renewal increase. Calculated from the RERA index (grey); type a % to override.',
            valueGetter: (p) => {
              if (!p.data) return null;
              const v = p.data.increasePctOverride ?? p.data.increasePct;
              return v === null || v === undefined ? null : Math.round(v * 10000) / 100;
            },
            valueSetter: (p) => {
              const n = parseNum(p.newValue);
              p.data.increasePctOverride = n === null ? null : n / 100;
              return true;
            },
            valueFormatter: (p) => (p.value === null || p.value === undefined ? '' : `${p.value}%`),
            cellClass: (p) => (p.data?.increasePctOverride !== null && p.data?.increasePctOverride !== undefined ? 'cell-override' : 'cell-derived'),
          },
          inputCol('cheques', 'Cheques / yr', 'int', { headerTooltip: 'Equal cheques per year for renewals (blank = 4). Exact dates/amounts in the row panel.' }),
          inputCol('notes', 'Notes', 'text', { cellEditor: 'agLargeTextCellEditor', cellEditorPopup: true, maxWidth: 260 }),
        ],
      },
      {
        headerName: 'RERA index',
        headerClass: 'hdr-rera',
        children: [
          derivedCol('reraKey', 'Index', (r) => `${r.propertyCode}-${r.bedroom ?? ''}`, 'text', 'Property code - bedroom code: the RERA index row used'),
          derivedCol('reraMin', 'Low', (r) => r.reraMin, 'money'),
          derivedCol('reraMax', 'High', (r) => r.reraMax, 'money'),
          derivedCol('reraAvg', 'Average', (r) => r.reraAverage, 'money'),
          derivedCol('oldPsf', 'Old Rent psf', (r) => psf(r.currentRent, r.area), 'money2'),
          derivedCol('newPsf', 'New Rent psf', (r) => psf(r.r1?.rent, r.area), 'money2'),
          derivedCol('reraGap', '% Difference', (r) => r.reraGap, 'pct', 'How far the current rent is below the RERA average'),
          derivedCol('incAllowed', 'Increase Allowed', (r) => r.increasePct, 'pct', 'From the RERA bands (or labour / camp increase)'),
          derivedCol('staffDisc', 'Staff Discount', (r) => (r.staffOwner === 'STAFF' ? staffDiscount : 0), 'pct'),
        ],
      },
      {
        headerName: '1st renewal',
        headerClass: 'hdr-input',
        children: [
          overrideCol('r1Mf', (r) => r.r1?.mf ?? null, 'yn', 'MF'),
          overrideCol('r1Start', (r) => r.r1?.start ?? null, 'date', 'Start Date'),
          overrideCol('r1End', (r) => r.r1?.end ?? null, 'date', 'End Date'),
          overrideCol('r1Rent', (r) => r.r1?.rent ?? null, 'money', 'Amount'),
        ],
      },
      {
        headerName: '2nd renewal',
        headerClass: 'hdr-input',
        children: [
          inputCol('r2Renew', 'Renew', 'yn', { headerTooltip: 'Blank = automatic when the 1st renewal ends inside the year. N = none.' }),
          overrideCol('r2Mf', (r) => r.r2?.mf ?? null, 'yn', 'MF'),
          overrideCol('r2Start', (r) => r.r2?.start ?? null, 'date', 'Start Date'),
          overrideCol('r2End', (r) => r.r2?.end ?? null, 'date', 'End Date'),
          overrideCol('r2Rent', (r) => r.r2?.rent ?? null, 'money', 'Amount'),
        ],
      },
      {
        headerName: '3rd renewal',
        headerClass: 'hdr-input',
        children: [
          inputCol('r3Renew', 'Renew', 'yn', { headerTooltip: 'Blank = automatic when the 2nd renewal ends inside the year. N = none.' }),
          overrideCol('r3Mf', (r) => r.r3?.mf ?? null, 'yn', 'MF'),
          overrideCol('r3Start', (r) => r.r3?.start ?? null, 'date', 'Start Date'),
          overrideCol('r3End', (r) => r.r3?.end ?? null, 'date', 'End Date'),
          overrideCol('r3Rent', (r) => r.r3?.rent ?? null, 'money', 'Amount'),
        ],
      },
      {
        headerName: 'Vacancy',
        headerClass: 'hdr-rera',
        children: [derivedCol('vacancyLoss', 'Vacancy Loss', (r) => r.vacancyLoss, 'money', 'Gap between the lease ending and the next tenant, at the new rent')],
      },
    ];
    if (showRevenue) defs.push({ headerName: `Revenue budget ${year}`, headerClass: 'hdr-revenue', children: monthCols('revenue', 'revenueTotal', 'hdr-revenue') });
    if (showCash)
      defs.push({ headerName: `Cash inflow ${year} (rent + VAT + deposits)`, headerClass: 'hdr-cash', children: monthCols('cashFlow', 'cashFlowTotal', 'hdr-cash') });
    return defs;
  }, [showRevenue, showCash, year, staffDiscount]);

  const onGridReady = useCallback(
    (e: GridReadyEvent<Row>) => {
      apiRef.current = e.api;
      refreshTotals();
    },
    [refreshTotals],
  );

  const visibleRows = useMemo(() => (onlyIssues ? rows.filter((r) => r.warnings.length) : rows), [rows, onlyIssues]);
  const editableSelected = selectedProperty ? properties.find((p) => p.id === selectedProperty)?.editable : false;
  const leased = rows.filter((r) => r.currentEnd).length;

  return (
    <div className="flex h-screen flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <h1 className="mr-1 text-base font-semibold text-slate-900">Lease Budget</h1>
        <select className="input w-72" value={selectedProperty ?? 'all'} onChange={(e) => startNav(() => router.push(`/master?p=${e.target.value}`))}>
          <option value="all">All properties ({properties.length})</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
              {p.editable ? '' : ' (read only)'}
            </option>
          ))}
        </select>
        <input className="input w-56" placeholder="Search unit, tenant…" onChange={(e) => apiRef.current?.setGridOption('quickFilterText', e.target.value)} />
        <label className="flex items-center gap-1 text-[13px]">
          <input type="checkbox" checked={showRevenue} onChange={(e) => setShowRevenue(e.target.checked)} /> Revenue
        </label>
        <label className="flex items-center gap-1 text-[13px]">
          <input type="checkbox" checked={showCash} onChange={(e) => setShowCash(e.target.checked)} /> Cash
        </label>
        <label className="flex items-center gap-1 text-[13px]">
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Issues only
        </label>
        <button className="btn btn-xs" onClick={() => apiRef.current?.autoSizeAllColumns()} title="Fit every column to its content">
          Auto-fit columns
        </button>
        <span className="text-xs text-slate-500">
          {leased} of {rows.length} units have a Fusion lease
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className={`text-xs ${status.kind === 'error' ? 'text-red-600' : status.kind === 'saved' ? 'text-emerald-700' : 'text-slate-500'}`}>
            {locked ? 'Version locked: read only' : status.kind === 'saving' ? (status.text ?? 'Saving…') : status.text}
          </span>
          {editableSelected && (
            <button className="btn" onClick={() => setAdding((a) => !a)}>
              + Add unit
            </button>
          )}
          <a className="btn" href={`/api/export/master?p=${selectedProperty ?? 'all'}`}>
            Export to Excel
          </a>
        </div>
      </div>
      <Legend />

      {adding && selectedProperty && (
        <AddUnitForm
          onCancel={() => setAdding(false)}
          onAdd={async (input) => {
            const res = await addUnit(versionId, { ...input, propertyId: selectedProperty });
            if (res.error) return res.error;
            apiRef.current?.applyTransaction({ add: [res.row!] });
            refreshTotals();
            setAdding(false);
            return null;
          }}
        />
      )}

      {errors.length > 0 && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {errors.slice(0, 5).map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 p-2">
        <AgGridReact<Row>
          theme={theme}
          rowData={visibleRows}
          columnDefs={columnDefs}
          defaultColDef={{ resizable: true, sortable: true, minWidth: 56 }}
          autoSizeStrategy={{ type: 'fitCellContents', defaultMaxWidth: 300, continuous: true }}
          // measure every column when auto-fitting, not only the ones on screen
          suppressColumnVirtualisation
          getRowId={(p: GetRowIdParams<Row>) => String(p.data.lineId)}
          onGridReady={onGridReady}
          onCellValueChanged={onCellValueChanged}
          onFilterChanged={refreshTotals}
          onRowDataUpdated={refreshTotals}
          rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
          onSelectionChanged={(e: SelectionChangedEvent<Row>) => setSelected(e.api.getSelectedRows()[0] ?? null)}
          getRowClass={(p: RowClassParams<Row>) => (p.data?.warnings?.length && !p.node.isRowPinned() ? 'row-warning' : undefined)}
          singleClickEdit={false}
          enterNavigatesVerticallyAfterEdit
          stopEditingWhenCellsLoseFocus
          undoRedoCellEditing
          tooltipShowDelay={300}
          animateRows={false}
        />
      </div>

      {selected && (
        <RowDetail
          row={selected}
          year={year}
          onClose={() => setSelected(null)}
          onSave={(patch) => {
            queue.current.set(selected.lineId, { ...(queue.current.get(selected.lineId) ?? {}), ...patch });
            if (timer.current) clearTimeout(timer.current);
            void flush();
          }}
          onRemove={
            selected.editable
              ? async () => {
                  if (!confirm(`Remove ${selected.unitCode} from this budget version?`)) return;
                  const res = await removeLine(versionId, selected.lineId);
                  if (res.error) return alert(res.error);
                  apiRef.current?.applyTransaction({ remove: [selected] });
                  refreshTotals();
                  setSelected(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function Legend() {
  const item = (color: string, label: string) => (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-0.5 w-4" style={{ background: color }} />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-4 py-1.5 text-[11px] text-slate-500">
      {item('#64748b', 'Unit master')}
      {item('#14b8a6', 'Oracle Fusion (read-only)')}
      {item('#f59e0b', 'Budget inputs')}
      {item('#a78bfa', 'Calculated')}
      {item('#3b82f6', 'Revenue')}
      {item('#10b981', 'Cash')}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-4 rounded-sm" style={{ background: 'rgba(245,158,11,0.18)' }} /> overridden value
      </span>
      <span className="text-slate-400">Click a row for its contracts and cheque schedules</span>
    </div>
  );
}

function AddUnitForm({
  onAdd,
  onCancel,
}: {
  onAdd: (i: { unitCode: string; rc: 'R' | 'C' | 'L'; bedroom: string | null; area: number | null; unitType: string | null }) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-b border-slate-200 bg-sky-50 px-4 py-2 text-[13px]"
      action={async (f) => {
        const err = await onAdd({
          unitCode: String(f.get('unitCode') ?? ''),
          rc: (f.get('rc') as 'R' | 'C' | 'L') ?? 'R',
          bedroom: (f.get('bedroom') as string) || null,
          area: parseNum(f.get('area')),
          unitType: (f.get('unitType') as string) || null,
        });
        setError(err);
      }}
    >
      <label>
        Unit code
        <input name="unitCode" required className="input ml-1 w-44" />
      </label>
      <label>
        R/C
        <select name="rc" className="input ml-1">
          <option>R</option>
          <option>C</option>
          <option>L</option>
        </select>
      </label>
      <label>
        BR
        <input name="bedroom" className="input ml-1 w-16" />
      </label>
      <label>
        SQF
        <input name="area" className="input ml-1 w-24" />
      </label>
      <label>
        Unit type
        <input name="unitType" className="input ml-1 w-40" />
      </label>
      <button className="btn-primary">Add</button>
      <button type="button" className="btn" onClick={onCancel}>
        Cancel
      </button>
      {error && <span className="text-red-600">{error}</span>}
    </form>
  );
}

function RowDetail({
  row,
  year,
  onClose,
  onRemove,
  onSave,
}: {
  row: Row;
  year: number;
  onClose: () => void;
  onRemove?: () => void;
  onSave: (patch: RowPatch) => void;
}) {
  const kind = row.rc === 'R' ? 'Residential' : row.rc === 'C' ? 'Commercial' : 'Labour';
  const contracts = [
    row.current && { key: 'current', title: 'Current lease · Fusion', c: row.current, field: null, note: 'Cheques from Fusion lease schedules once connected' },
    row.r1 && { key: 'r1', title: row.renew1 ? '1st renewal' : '1st renewal · new tenant', c: row.r1, field: 'r1Schedule' as const, note: undefined },
    row.r2 && { key: 'r2', title: '2nd renewal', c: row.r2, field: 'r2Schedule' as const, note: undefined },
    row.r3 && { key: 'r3', title: '3rd renewal', c: row.r3, field: 'r3Schedule' as const, note: undefined },
  ].filter(Boolean) as {
    key: string;
    title: string;
    c: NonNullable<Row['r1']>;
    field: 'r1Schedule' | 'r2Schedule' | 'r3Schedule' | null;
    note?: string;
  }[];

  return (
    <div className="max-h-[46vh] overflow-auto border-t-2 border-sky-700 bg-white px-4 py-3 text-[13px]">
      <div className="mb-3 flex items-start gap-3">
        <div>
          <div className="font-semibold text-slate-900">
            {row.unitCode} <span className="font-normal text-slate-400">·</span> {row.tenant ?? 'No current lease'}
          </div>
          <div className="text-xs text-slate-500">
            {row.propertyName} · {kind}
            {row.area ? ` · ${fmt(row.area)} sq.ft` : ''}
            {row.leaseNumber ? ` · lease ${row.leaseNumber} v${row.leaseVersion ?? '–'}` : ''}
            {row.increasePct !== null ? ` · renewal increase ${pct(row.increasePct)}` : ''}
            {row.reraAverage ? ` · RERA avg ${fmt(row.reraAverage)}` : ''}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          {onRemove && (
            <button className="btn text-red-700" onClick={onRemove}>
              Remove unit
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {row.warnings.length > 0 && (
        <ul className="mb-3 list-disc rounded-md border border-amber-200 bg-amber-50 py-1.5 pr-3 pl-7 text-xs text-amber-700">
          {row.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {contracts.length === 0 && (
        <p className="mb-3 text-xs text-slate-500">
          No current lease from Fusion. To budget a lease-up, set Renew = N, a budget rate, and the 1st renewal start date.
        </p>
      )}

      <div className="flex gap-3 overflow-x-auto pb-1">
        {contracts.map(({ key, title, c, field, note }) => (
          <div key={key} className="shrink-0">
            <div className="mb-1 flex gap-3 px-0.5 text-xs text-slate-600">
              <span>
                Rent <b className="text-slate-900 tabular-nums">{fmt(c.rent)}</b>
              </span>
              <span>
                {ymdToDmy(c.start)} – {ymdToDmy(c.end)}
              </span>
              <span>MF {yn(c.mf)}</span>
            </div>
            <ScheduleEditor
              title={title}
              contract={c}
              year={year}
              editable={row.editable && field !== null}
              overrideNote={note}
              onSave={(items) => field && onSave({ [field]: items } as RowPatch)}
            />
          </div>
        ))}
      </div>

      <table className="tbl mt-3">
        <thead>
          <tr>
            <th className="w-72">{year}</th>
            {MONTHS.map((m) => (
              <th key={m} className="num w-20">
                {m}
              </th>
            ))}
            <th className="num w-24">Total</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ['Revenue', row.revenue, row.revenueTotal],
              ['Rent cheques (ex VAT)', row.cash, row.cashTotal],
              ['Cash inflow (incl. VAT, deposits)', row.cashFlow, row.cashFlowTotal],
            ] as const
          ).map(([label, vals, total]) => (
            <tr key={label}>
              <td>{label}</td>
              {vals.map((v, i) => (
                <td key={i} className="num">
                  {fmt(v)}
                </td>
              ))}
              <td className="num font-semibold">{fmt(total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
