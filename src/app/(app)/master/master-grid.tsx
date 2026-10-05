'use client';

import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
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

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontSize: 12,
  rowHeight: 28,
  headerHeight: 30,
  spacing: 5,
  headerBackgroundColor: '#f1f5f9',
  fontFamily: 'inherit',
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

/** Column for a field that holds a PM override; blank override shows the engine's derived value. */
function overrideCol(
  field: keyof Row,
  derived: (r: Row) => unknown,
  kind: 'money' | 'date' | 'yn',
  headerName: string,
  width = 100,
): ColDef<Row> {
  return {
    colId: field as string,
    headerName,
    width,
    editable,
    headerTooltip: 'Blank = calculated (grey). Type a value to override (bold). Delete to revert.',
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

function inputCol(field: keyof Row, headerName: string, kind: 'text' | 'money' | 'int' | 'date' | 'yn' | 'ynReq', width = 100, extra: Partial<ColDef<Row>> = {}): ColDef<Row> {
  const base: ColDef<Row> = { colId: field as string, field, headerName, width, editable, cellClass: inputClass, cellDataType: false };
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
    case 'date':
      return { ...base, valueFormatter: (p) => ymdToDmy(p.value), valueParser: (p) => parseDate(p.newValue), ...extra };
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

function monthCols(key: 'revenue' | 'cash', totalKey: 'revenueTotal' | 'cashTotal'): ColDef<Row>[] {
  return [
    ...MONTHS.map(
      (m, i): ColDef<Row> => ({
        colId: `${key}_${i}`,
        headerName: m,
        width: 88,
        type: 'rightAligned',
        cellClass: 'cell-month',
        valueGetter: (p) => p.data?.[key]?.[i] ?? 0,
        valueFormatter: money,
      }),
    ),
    {
      colId: totalKey,
      headerName: 'Total',
      width: 105,
      type: 'rightAligned',
      cellClass: 'cell-month font-semibold',
      valueGetter: (p) => p.data?.[totalKey] ?? 0,
      valueFormatter: money,
    },
  ];
}

// ---------- component --------------------------------------------------------------------------

export function MasterGrid({
  versionId,
  year,
  locked,
  rows,
  properties,
  selectedProperty,
}: {
  versionId: number;
  year: number;
  locked: boolean;
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
  const [onlyWarnings, setOnlyWarnings] = useState(false);
  const [adding, setAdding] = useState(false);
  const [, startNav] = useTransition();

  const refreshTotals = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const t = { revenue: Array(12).fill(0), cash: Array(12).fill(0), revenueTotal: 0, cashTotal: 0, currentRent: 0, count: 0 };
    api.forEachNodeAfterFilter((n) => {
      if (!n.data) return;
      t.count++;
      t.currentRent += n.data.currentRent ?? 0;
      n.data.revenue.forEach((v, i) => (t.revenue[i] += v));
      n.data.cash.forEach((v, i) => (t.cash[i] += v));
      t.revenueTotal += n.data.revenueTotal;
      t.cashTotal += n.data.cashTotal;
    });
    api.setGridOption('pinnedBottomRowData', [
      {
        unitCode: `Total (${t.count} units)`,
        currentRent: t.currentRent,
        revenue: t.revenue,
        cash: t.cash,
        revenueTotal: t.revenueTotal,
        cashTotal: t.cashTotal,
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
        children: [
          { colId: 'propertyName', field: 'propertyName', headerName: 'Property', width: 190, pinned: 'left', filter: true },
          {
            colId: 'unitCode',
            field: 'unitCode',
            headerName: 'Unit Code',
            width: 150,
            pinned: 'left',
            filter: true,
            cellClass: (p) => (p.node.isRowPinned() ? 'font-semibold' : ''),
          },
          inputCol('tenant', 'Tenant', 'text', 200, { pinned: 'left', filter: true }),
          {
            colId: 'warnings',
            headerName: '⚠',
            width: 46,
            pinned: 'left',
            valueGetter: (p) => (p.data?.warnings?.length ? p.data.warnings.length : ''),
            tooltipValueGetter: (p) => p.data?.warnings?.join('\n') || undefined,
            cellClass: 'text-amber-600 font-semibold text-center',
          },
        ],
      },
      {
        headerName: 'Unit details',
        children: [
          { colId: 'buCode', field: 'buCode', headerName: 'BU', width: 60, filter: true },
          { colId: 'coordinator', field: 'coordinator', headerName: 'PC', width: 80, filter: true },
          inputCol('bedroom', 'BR', 'text', 60),
          inputCol('area', 'SQF', 'money', 80),
          { ...inputCol('rc', 'R/C', 'text', 60), cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['R', 'C', 'L'] }, filter: true },
          inputCol('unitType', 'Unit Type', 'text', 130, { filter: true }),
          inputCol('rooms', 'Rooms', 'int', 70, { hide: true }),
          inputCol('capacity', 'Capacity', 'int', 80, { hide: true }),
          inputCol('vacant', 'Vacant', 'ynReq', 70, { filter: true }),
          {
            ...inputCol('staffOwner', 'Staff/Owner', 'text', 95),
            cellEditor: 'agSelectCellEditor',
            cellEditorParams: { values: ['', 'STAFF', 'OWNER'] },
            valueParser: (p) => (p.newValue ? p.newValue : null),
          },
        ],
      },
      {
        headerName: 'Current contract',
        children: [
          inputCol('mfCurrent', 'MF', 'yn', 55),
          inputCol('currentRent', 'Rent', 'money', 105),
          inputCol('currentStart', 'Start', 'date', 95),
          inputCol('currentEnd', 'End', 'date', 95),
        ],
      },
      {
        headerName: `1st renewal`,
        children: [
          inputCol('renew1', 'Renew', 'ynReq', 70, { headerTooltip: 'Y = same tenant renews (RERA increase). N = new tenant after the vacancy gap at the budget rate.' }),
          inputCol('noRenewal', 'Not re-let', 'ynReq', 85, { headerTooltip: 'Y = unit is not let again after the current contract' }),
          inputCol('budgetRate', 'Budget rate', 'money', 100, {
            headerTooltip: 'New-tenant rate. Residential: annual rent · Commercial/labour: AED per sq.ft per year · Camps: AED per bed per month',
          }),
          {
            colId: 'increasePctOverride',
            headerName: 'Incr. %',
            width: 75,
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
          {
            colId: 'reraAverage',
            headerName: 'RERA avg',
            width: 85,
            type: 'rightAligned',
            valueGetter: (p) => p.data?.reraAverage ?? null,
            valueFormatter: money,
            cellClass: 'cell-derived',
            hide: true,
          },
          overrideCol('r1Mf', (r) => r.r1?.mf ?? null, 'yn', 'MF', 55),
          overrideCol('r1Rent', (r) => r.r1?.rent ?? null, 'money', 'Rent', 105),
          overrideCol('r1Start', (r) => r.r1?.start ?? null, 'date', 'Start', 95),
          overrideCol('r1End', (r) => r.r1?.end ?? null, 'date', 'End', 95),
        ],
      },
      {
        headerName: '2nd renewal',
        children: [
          inputCol('r2Renew', 'Renew', 'yn', 65, { headerTooltip: 'Blank = automatic when the 1st renewal ends before 31 Dec. N = no 2nd renewal.' }),
          overrideCol('r2Mf', (r) => r.r2?.mf ?? null, 'yn', 'MF', 55),
          overrideCol('r2Rent', (r) => r.r2?.rent ?? null, 'money', 'Rent', 105),
          overrideCol('r2Start', (r) => r.r2?.start ?? null, 'date', 'Start', 95),
          overrideCol('r2End', (r) => r.r2?.end ?? null, 'date', 'End', 95),
        ],
      },
      {
        headerName: 'Other',
        children: [
          inputCol('cheques', 'Cheques', 'int', 80, { headerTooltip: 'Number of cheques per contract (blank = default 4)' }),
          { colId: 'vacancyLoss', headerName: 'Vacancy loss', width: 100, type: 'rightAligned', valueGetter: (p) => p.data?.vacancyLoss ?? 0, valueFormatter: money },
          { colId: 'otherIncomeTotal', headerName: 'Fees', width: 85, type: 'rightAligned', valueGetter: (p) => p.data?.otherIncomeTotal ?? 0, valueFormatter: money, headerTooltip: 'Admin + Ejari + MF + Agency fees from this unit' },
          inputCol('notes', 'Notes', 'text', 220, { cellEditor: 'agLargeTextCellEditor', cellEditorPopup: true }),
        ],
      },
    ];
    if (showRevenue) defs.push({ headerName: `Revenue ${year}`, children: monthCols('revenue', 'revenueTotal') });
    if (showCash) defs.push({ headerName: `Cash ${year}`, children: monthCols('cash', 'cashTotal') });
    return defs;
  }, [showRevenue, showCash, year]);

  const onGridReady = useCallback(
    (e: GridReadyEvent<Row>) => {
      apiRef.current = e.api;
      refreshTotals();
    },
    [refreshTotals],
  );

  const visibleRows = useMemo(() => (onlyWarnings ? rows.filter((r) => r.warnings.length) : rows), [rows, onlyWarnings]);
  const editableSelected = selectedProperty ? properties.find((p) => p.id === selectedProperty)?.editable : false;

  return (
    <div className="flex h-screen flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <h1 className="mr-2 text-base font-semibold">Revenue Master</h1>
        <select
          className="input w-72"
          value={selectedProperty ?? 'all'}
          onChange={(e) => startNav(() => router.push(`/master?p=${e.target.value}`))}
        >
          <option value="all">All properties ({properties.length})</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
              {p.editable ? '' : ' (read only)'}
            </option>
          ))}
        </select>
        <input
          className="input w-56"
          placeholder="Search unit, tenant…"
          onChange={(e) => apiRef.current?.setGridOption('quickFilterText', e.target.value)}
        />
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={showRevenue} onChange={(e) => setShowRevenue(e.target.checked)} /> Revenue
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={showCash} onChange={(e) => setShowCash(e.target.checked)} /> Cash
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={onlyWarnings} onChange={(e) => setOnlyWarnings(e.target.checked)} /> Warnings only
        </label>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={`text-xs ${
              status.kind === 'error' ? 'text-red-600' : status.kind === 'saved' ? 'text-emerald-700' : 'text-slate-500'
            }`}
          >
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

      <div className="min-h-0 flex-1">
        <AgGridReact<Row>
          theme={theme}
          rowData={visibleRows}
          columnDefs={columnDefs}
          defaultColDef={{ resizable: true, sortable: true, suppressHeaderMenuButton: false }}
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
      className="flex flex-wrap items-end gap-2 border-b border-slate-200 bg-sky-50 px-4 py-2 text-sm"
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

function RowDetail({ row, year, onClose, onRemove }: { row: Row; year: number; onClose: () => void; onRemove?: () => void }) {
  const contracts = [
    { label: 'Current', rent: row.currentRent, start: row.currentStart, end: row.currentEnd, mf: row.mfCurrent },
    row.r1 && { label: row.renew1 ? '1st renewal' : '1st renewal (new tenant)', ...row.r1 },
    row.r2 && { label: '2nd renewal', ...row.r2 },
  ].filter(Boolean) as { label: string; rent: number | null; start: string | null; end: string | null; mf: boolean | null }[];
  return (
    <div className="max-h-[38vh] overflow-auto border-t-2 border-slate-300 bg-white px-4 py-3 text-sm">
      <div className="mb-2 flex items-center gap-3">
        <div className="font-semibold">
          {row.unitCode} · {row.tenant ?? '—'}
        </div>
        <div className="text-xs text-slate-500">
          {row.propertyName} · {row.rc === 'R' ? 'Residential' : row.rc === 'C' ? 'Commercial' : 'Labour'}
          {row.area ? ` · ${fmt(row.area)} sq.ft` : ''}
          {row.increasePct !== null ? ` · renewal increase ${pct(row.increasePct)}` : ''}
          {row.reraAverage ? ` · RERA avg ${fmt(row.reraAverage)}` : ''}
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
        <ul className="mb-2 list-disc pl-5 text-xs text-amber-700">
          {row.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-6">
        <table className="table-fin w-auto">
          <thead>
            <tr>
              <th>Contract</th>
              <th className="num">Rent</th>
              <th>Start</th>
              <th>End</th>
              <th>MF</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.label}>
                <td>{c.label}</td>
                <td className="num">{fmt(c.rent)}</td>
                <td>{ymdToDmy(c.start)}</td>
                <td>{ymdToDmy(c.end)}</td>
                <td>{yn(c.mf)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="table-fin w-auto">
          <thead>
            <tr>
              <th>{year}</th>
              {MONTHS.map((m) => (
                <th key={m} className="num">
                  {m}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Revenue</td>
              {row.revenue.map((v, i) => (
                <td key={i} className="num">
                  {fmt(v)}
                </td>
              ))}
              <td className="num font-semibold">{fmt(row.revenueTotal)}</td>
            </tr>
            <tr>
              <td>Cash</td>
              {row.cash.map((v, i) => (
                <td key={i} className="num">
                  {fmt(v)}
                </td>
              ))}
              <td className="num font-semibold">{fmt(row.cashTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
