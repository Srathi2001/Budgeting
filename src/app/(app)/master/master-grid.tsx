'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
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
import { MF_LABEL, defaultMfRenewal, type MasterRow, type MfChoice, type RowPatch } from '@/lib/budget/master-types';
import { count, fmt, fmtDate, MONTHS, parseDate, pct } from '@/lib/format';
import { saveLines, addUnit, removeLine, saveRera } from './actions';
import { RowForm } from './row-form';
import { TemplateImport } from './template-import';
import { OUTCOMES, annualRent, needsVacancyDays, outcomeOf, outcomePatch, rentPsf, type Outcome } from './row-logic';
import { ExcelFilter } from '@/components/excel-filter';
import { LeaseTabs } from './lease-tabs';

ModuleRegistry.registerModules([AllCommunityModule]);

// Design-system tokens (CSS variables), so the grid follows the Paper / Carbon theme.
// Quiet header on the surface, no zebra, square.
const theme = themeQuartz.withParams({
  browserColorScheme: 'inherit',
  fontFamily: 'inherit',
  fontSize: 13,
  rowHeight: 28,
  headerHeight: 30,
  spacing: 5,
  backgroundColor: 'var(--surface)',
  foregroundColor: 'var(--ink)',
  // quiet headers (see --th-* in globals.css): no dark fill, one rule underneath
  chromeBackgroundColor: 'var(--th-bg)',
  headerBackgroundColor: 'var(--th-bg)',
  headerTextColor: 'var(--th-ink)',
  headerRowBorder: { color: 'var(--th-rule)' },
  headerFontSize: 11,
  headerFontWeight: 700,
  borderColor: 'var(--line)',
  // light rules: a faint line per row, a vertical line only where a column group starts (group-start)
  rowBorder: { color: 'var(--line-soft)' },
  columnBorder: false,
  headerColumnBorder: { color: 'var(--line-soft)' },
  oddRowBackgroundColor: 'var(--surface)',
  // a faint darkening, so a hovered row keeps its fills (white inputs, gray locked) readable
  rowHoverColor: 'color-mix(in srgb, var(--ink) 6%, transparent)',
  selectedRowBackgroundColor: 'var(--header-3)',
  accentColor: 'var(--ink)',
  // pinned total row: cell-total black, ink-inverse, double rule above
  pinnedRowBackgroundColor: 'var(--cell-total)',
  pinnedRowTextColor: 'var(--ink-inverse)',
  pinnedRowFontWeight: 700,
  pinnedRowBorder: { style: 'double', width: 3, color: 'var(--line-strong)' },
  borderRadius: 2,
  wrapperBorderRadius: 0,
});

type Row = MasterRow;
type P = { id: number; code: string; name: string; editable: boolean };

// ---------- value helpers ----------------------------------------------------------------------

const ymdToDmy = (v: unknown) => (typeof v === 'string' ? fmtDate(v) : '');


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
/** whole numbers (days, cheques, rooms, area) */
const whole = (p: ValueFormatterParams) => count(p.value as number | null);

/** Field from Oracle (the lease report import): fixed for everyone; the next import refreshes it. */
function oracleCol(
  field: keyof Row,
  headerName: string,
  _isAdmin: boolean,
  kind: 'text' | 'money' | 'date' = 'text',
  extra: Partial<ColDef<Row>> = {},
): ColDef<Row> {
  return {
    colId: field as string,
    field,
    headerName,
    headerClass: extra.headerClass ?? 'hdr-fusion',
    headerTooltip: 'Fixed: from the Oracle import',
    cellClass: 'cell-fusion',
    editable: false,
    cellDataType: false,
    ...(kind === 'text' ? { valueParser: (p: { newValue: unknown }) => (p.newValue === '' ? null : p.newValue) } : {}),
    ...(kind === 'money'
      ? { type: 'rightAligned', valueFormatter: money, valueParser: (p: { newValue: unknown }) => parseNum(p.newValue) }
      : {}),
    ...(kind === 'date'
      ? { valueFormatter: (p: ValueFormatterParams) => ymdToDmy(p.value), valueParser: (p: { newValue: unknown }) => parseDate(p.newValue) }
      : {}),
    ...extra,
  };
}

/** Column for a field that holds a PM override; blank override shows the engine's derived value. */
function overrideCol(
  field: keyof Row,
  derived: (r: Row) => unknown,
  kind: 'money' | 'date' | 'yn',
  headerName: string,
  /** rows where the field is fixed (e.g. a contracted lease year for non-admins) */
  lockedFor?: (r: Row) => boolean,
): ColDef<Row> {
  return {
    colId: field as string,
    headerName,
    headerClass: 'hdr-input',
    editable: (p) => editable(p) && !(p.data && lockedFor?.(p.data)),
    headerTooltip: 'Blank = calculated (grey). Type a value to override (dark). Delete to revert.',
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
    cellClass: (p) => {
      if (p.node.isRowPinned()) return '';
      const state = p.data?.[field] !== null && p.data?.[field] !== undefined ? 'cell-override' : 'cell-derived';
      return p.data?.editable && !lockedFor?.(p.data) ? `${state} cell-input` : state;
    },
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
        valueFormatter: kind === 'int' ? whole : money,
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
    cellClass: 'cell-fusion',
    cellDataType: false,
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

/** Adds the column-group rule to a column, keeping its own cell classes. */
function groupStart(c: ColDef<Row>): ColDef<Row> {
  const own = c.cellClass;
  return {
    ...c,
    cellClass: (p: CellClassParams<Row>) => {
      const base = typeof own === 'function' ? own(p) : own;
      const list = Array.isArray(base) ? base : base ? [base] : [];
      return list.includes('group-start') ? list : [...list, 'group-start'];
    },
  };
}

function monthCols(key: 'revenue' | 'cashFlow', hdr: string): ColDef<Row>[] {
  return MONTHS.map(
    (m, i): ColDef<Row> => ({
      colId: `${key}_${i}`,
      headerName: m,
      headerClass: hdr,
      type: 'rightAligned',
      cellClass: `cell-month${i === 0 ? ' group-start' : ''}`,
      valueGetter: (p) => p.data?.[key]?.[i] ?? 0,
      valueFormatter: money,
    }),
  );
}

// ---------- component --------------------------------------------------------------------------

export function MasterGrid({
  versionId,
  year,
  locked,
  staffDiscount,
  mfPct,
  rows,
  properties,
  selectedProperties,
  isAdmin,
}: {
  versionId: number;
  year: number;
  locked: boolean;
  staffDiscount: number;
  /** maintenance fee on renewals / new tenants, share of rent */
  mfPct: number;
  rows: Row[];
  properties: P[];
  /** properties in view; empty = all */
  selectedProperties: number[];
  /** only an admin can change Oracle fields and contracted lease years */
  isAdmin: boolean;
}) {
  const apiRef = useRef<GridApi<Row> | null>(null);
  const queue = useRef(new Map<number, RowPatch>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ kind: 'idle' });
  const [errors, setErrors] = useState<string[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [showRevenue, setShowRevenue] = useState(false);
  const [showCash, setShowCash] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const refreshTotals = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const t = { revenue: Array(12).fill(0), cashFlow: Array(12).fill(0), revenueTotal: 0, cashFlowTotal: 0, currentRent: 0, maintenanceTotal: 0, count: 0 };
    api.forEachNodeAfterFilter((n) => {
      if (!n.data) return;
      t.count++;
      t.currentRent += n.data.currentRent ?? 0;
      t.maintenanceTotal += n.data.maintenanceTotal;
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
        maintenanceTotal: t.maintenanceTotal,
        warnings: [],
        editable: false,
      } as unknown as Row,
    ]);
  }, []);

  /** Sends queued edits; returns the first rejection message, or null. */
  const flush = useCallback(async (): Promise<string | null> => {
    const changes = [...queue.current.entries()].map(([lineId, patch]) => ({ lineId, patch }));
    queue.current.clear();
    if (!changes.length) return null;
    setStatus({ kind: 'saving' });
    try {
      const res = await saveLines(versionId, changes);
      apiRef.current?.applyTransaction({ update: res.rows });
      setSelected((s) => (s ? (res.rows.find((r) => r.lineId === s.lineId) ?? s) : s));
      refreshTotals();
      if (res.errors.length) {
        setErrors(res.errors.map((e) => `${res.rows.find((r) => r.lineId === e.lineId)?.unitCode ?? e.lineId}: ${e.message}`));
        setStatus({ kind: 'error', text: `${res.errors.length} change(s) rejected` });
        return res.errors[0].message;
      }
      setErrors([]);
      setStatus({ kind: 'saved', text: `Saved ${changes.length} row(s) · recalculated` });
      return null;
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message });
      return (e as Error).message;
    }
  }, [versionId, refreshTotals]);

  const onCellValueChanged = useCallback(
    (e: CellValueChangedEvent<Row>) => {
      const col = e.column.getColId();
      if (!e.data) return;
      const patch = queue.current.get(e.data.lineId) ?? {};
      // the Outcome column stands for the two engine flags
      for (const field of col === 'outcome' ? ['renew1', 'noRenewal'] : [col]) (patch as Record<string, unknown>)[field] = (e.data as unknown as Record<string, unknown>)[field];
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
          { colId: 'propertyName', field: 'propertyName', headerName: 'Property', headerClass: 'hdr-unit', pinned: 'left', maxWidth: 220 },
          {
            colId: 'unitCode',
            field: 'unitCode',
            headerName: 'Unit Code',
            headerClass: 'hdr-unit',
            pinned: 'left',
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
        headerName: 'Unit · Oracle',
        headerClass: 'hdr-unit',
        children: [
          unitCol('buCode', 'BU'),
          unitCol('coordinator', 'PC'),
          oracleCol('resiCommercial', 'Unit Type', isAdmin, 'text', { headerClass: 'hdr-unit' }),
          oracleCol('bedroom', 'Bedroom / RERA', isAdmin, 'text', { headerClass: 'hdr-unit', headerTooltip: 'From the Oracle unit type: the key into the RERA index' }),
          oracleCol('area', 'Area (sq ft)', isAdmin, 'money', { headerClass: 'hdr-unit', valueFormatter: whole }),
          oracleCol('unitStatus', 'Unit Status', isAdmin, 'text', { headerClass: 'hdr-unit' }),
          oracleCol('unitUsage', 'Unit Usage', isAdmin, 'text', { headerClass: 'hdr-unit', headerTooltip: 'Fixed: from the Oracle Unit Dump' }),
          oracleCol('mergedUnitNumber', 'Merged Unit No.', isAdmin, 'text', { headerClass: 'hdr-unit', headerTooltip: 'Fixed: from the Oracle Unit Dump' }),
          oracleCol('landlord', 'Landlord', isAdmin, 'text', { headerClass: 'hdr-unit', maxWidth: 220, headerTooltip: 'Fixed: from the Oracle Unit Dump' }),
        ],
      },
      {
        headerName: 'Current lease · Oracle',
        headerClass: 'hdr-fusion',
        children: [
          oracleCol('tenantCode', 'Tenant Code', isAdmin),
          oracleCol('tenant', 'Tenant', isAdmin, 'text', { maxWidth: 260 }),
          oracleCol('leaseNumber', 'Lease No.', isAdmin),
          oracleCol('currentStart', 'Contract Start', isAdmin, 'date'),
          oracleCol('currentEnd', 'Contract End', isAdmin, 'date'),
          oracleCol('currentRent', 'Contract Amount', isAdmin, 'money', { headerTooltip: 'Rent for the contract dates (from Oracle)' }),
          derivedCol('annualRent', 'Annual Rent', (r) => annualRent(r), 'money', 'Contract amount ÷ contract days × 365'),
          derivedCol('rentPsf', 'Rent / sq ft', (r) => rentPsf(r), 'money2', 'Annual rent ÷ area'),
          oracleCol('securityDeposit', 'Security Deposit', isAdmin, 'money'),
          {
            ...oracleCol('mfStatus', 'MF', isAdmin, 'text', { headerTooltip: 'Maintenance fee on the current lease. Fixed: from the Oracle MF report' }),
            valueGetter: (p) => (!p.data || p.node?.isRowPinned() ? null : (p.data.mfStatus ?? (p.data.mfCurrent === true ? 'Yes' : p.data.mfCurrent === false ? 'No' : null))),
          },
          oracleCol('maintenanceFee', 'MF Amount', isAdmin, 'money', { headerTooltip: 'Maintenance fee on the current contract. Fixed: from Oracle' }),
        ],
      },
      {
        headerName: 'Budget inputs',
        headerClass: 'hdr-input',
        children: [
          {
            colId: 'outcome',
            headerName: 'Outcome',
            headerClass: 'hdr-input',
            headerTooltip: 'At the end of the current lease. Renew = RERA increase · New tenant = budget rate after the vacancy gap · Not re-let = stays empty',
            // contracted later years settle the outcome (Oracle): fixed
            editable: (p) => editable(p) && !!p.data && p.data.staffOwner !== 'OWNER' && !p.data.contracted,
            cellClass: inputClass,
            cellDataType: false,
            valueGetter: (p) => (p.data && !p.node?.isRowPinned() ? outcomeOf(p.data) : null),
            valueSetter: (p) => {
              Object.assign(p.data, outcomePatch(p.newValue as Outcome));
              return true;
            },
            cellEditor: 'agSelectCellEditor',
            // a vacant unit has no tenant to renew
            cellEditorParams: (p: { data?: Row }) => ({ values: p.data?.currentEnd ? [...OUTCOMES] : OUTCOMES.filter((o) => o !== 'Renew') }),
          },
          {
            ...inputCol('vacancyDays', 'Vacancy Days', 'int', {
              headerTooltip: 'New tenant: empty days between the lease end and the new tenant. Required; no default.',
            }),
            editable: (p) => editable(p) && !!p.data && needsVacancyDays(p.data),
            // required and missing: flagged like an issue
            cellClass: (p) =>
              !p.data || p.node.isRowPinned() || !needsVacancyDays(p.data) ? '' : p.data.vacancyDays === null ? 'cell-input cell-issue' : 'cell-input',
          },
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
          {
            ...overrideCol('r1Start', (r) => r.r1?.start ?? null, 'date', 'Renewal Start', (r) => r.contracted >= 1 || needsVacancyDays(r)),
            headerTooltip: '1st renewal / new tenant start. Blank = calculated (grey); type to override (dark). More in the row form.',
          },
          {
            ...overrideCol('r1Rent', (r) => r.r1?.rent ?? null, 'money', 'Renewal Rent', (r) => r.contracted >= 1),
            headerTooltip: '1st renewal rent. Blank = calculated (grey); type to override (dark). More in the row form.',
          },
          {
            colId: 'mfRenewal',
            headerName: 'MF on Renewal',
            headerClass: 'hdr-input',
            headerTooltip: `Maintenance fee on the renewal / new tenant: ${Math.round(mfPct * 100)}% of the rent, other income in the month the contract starts. Yes / No / Waived off; until chosen, the default shows in grey: renewal follows the current lease, new tenant Yes.`,
            editable: (p) => editable(p) && !!p.data && outcomeOf(p.data) !== 'Not re-let',
            cellDataType: false,
            valueGetter: (p) => (!p.data || p.node?.isRowPinned() ? null : MF_LABEL[p.data.mfRenewal ?? defaultMfRenewal(p.data)]),
            valueSetter: (p) => {
              const v = (Object.keys(MF_LABEL) as MfChoice[]).find((k) => MF_LABEL[k] === p.newValue) ?? null;
              p.data.mfRenewal = v;
              return true;
            },
            cellEditor: 'agSelectCellEditor',
            // three choices only: Yes / No / Waived off
            cellEditorParams: { values: Object.values(MF_LABEL) },
            cellClass: (p) => {
              if (!p.data || p.node.isRowPinned()) return '';
              const state = p.data.mfRenewal ? 'cell-override' : 'cell-derived';
              return p.data.editable && outcomeOf(p.data) !== 'Not re-let' ? `${state} cell-input` : state;
            },
          },
        ],
      },
      {
        headerName: `Result ${year}`,
        headerClass: 'hdr-rera',
        children: [
          { ...derivedCol('revenueTotal', 'Revenue', (r) => r.revenueTotal, 'money'), headerClass: 'hdr-revenue', valueGetter: (p) => p.data?.revenueTotal ?? 0 },
          { ...derivedCol('cashFlowTotal', 'Cash Inflow', (r) => r.cashFlowTotal, 'money', 'Rent cheques + VAT + deposits in − deposits out'), headerClass: 'hdr-cash', valueGetter: (p) => p.data?.cashFlowTotal ?? 0 },
          derivedCol('vacancyLoss', 'Vacancy Loss', (r) => r.vacancyLoss, 'money', 'Gap between the lease ending and the next tenant, at the new rent'),
          { ...derivedCol('maintenanceTotal', 'Maintenance Fee', (r) => r.maintenanceTotal, 'money', 'Other income (not rent): booked in the month each contract starts'), valueGetter: (p) => p.data?.maintenanceTotal ?? 0 },
        ],
      },
    ];
    if (showRevenue) defs.push({ headerName: `Revenue by month ${year}`, headerClass: 'hdr-revenue', children: monthCols('revenue', 'hdr-revenue') });
    if (showCash) defs.push({ headerName: `Cash inflow by month ${year} (rent + VAT + deposits)`, headerClass: 'hdr-cash', children: monthCols('cashFlow', 'hdr-cash') });
    // the one vertical rule per column group (the pinned Unit group ends at the pinned edge)
    return defs.map((d, i) => (i > 0 && 'children' in d ? { ...d, children: [groupStart(d.children[0] as ColDef<Row>), ...d.children.slice(1)] } : d));
  }, [showRevenue, showCash, year, isAdmin, mfPct]);

  const onGridReady = useCallback(
    (e: GridReadyEvent<Row>) => {
      apiRef.current = e.api;
      refreshTotals();
    },
    [refreshTotals],
  );

  const visibleRows = useMemo(() => (onlyIssues ? rows.filter((r) => r.warnings.length) : rows), [rows, onlyIssues]);

  /** Moves the form to the previous / next row as displayed (after sorting and filters). */
  const step = (dir: 1 | -1) => {
    const api = apiRef.current;
    if (!api || !selected) return;
    const node = api.getRowNode(String(selected.lineId));
    if (!node || node.rowIndex === null) return;
    const target = api.getDisplayedRowAtIndex(node.rowIndex + dir);
    if (!target?.data) return;
    target.setSelected(true, true);
    api.ensureNodeVisible(target);
  };
  // adding a unit needs exactly one property in view
  const selectedProperty = selectedProperties.length === 1 ? selectedProperties[0] : null;
  const editableSelected = selectedProperty ? properties.find((p) => p.id === selectedProperty)?.editable : false;
  const leased = rows.filter((r) => r.currentEnd).length;
  const pParam = selectedProperties.length ? selectedProperties.join(',') : 'all';

  return (
    <div className="flex h-[calc(100vh-var(--topbar-h))] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <h1 className="mr-1 text-base font-semibold text-slate-900">Lease Budget</h1>
        <LeaseTabs tab="grid" />
        <input className="input w-56" placeholder="Search unit, tenant…" onChange={(e) => apiRef.current?.setGridOption('quickFilterText', e.target.value)} />
        <label className="flex items-center gap-1 text-[13px]">
          <input type="checkbox" checked={showRevenue} onChange={(e) => setShowRevenue(e.target.checked)} /> Revenue by month
        </label>
        <label className="flex items-center gap-1 text-[13px]">
          <input type="checkbox" checked={showCash} onChange={(e) => setShowCash(e.target.checked)} /> Cash by month
        </label>
        <label className="flex items-center gap-1 text-[13px]">
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Issues only
        </label>
        <button className="btn btn-xs" onClick={() => apiRef.current?.autoSizeAllColumns()} title="Fit every column to its content">
          Auto-fit columns
        </button>
        <span className="text-xs text-slate-500">
          {leased} of {rows.length} units have a current lease
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
          <a className="btn" href={`/api/export/template?p=${pParam}`} title="Input template: instructions and the editable fields of the lines in view">
            Download template
          </a>
          {!locked && (
            <button className="btn" onClick={() => setImporting((v) => !v)}>
              Import Excel
            </button>
          )}
          <a className="btn" href={`/api/export/master?p=${pParam}`}>
            Export to Excel
          </a>
        </div>
      </div>
      <Legend />

      {importing && <TemplateImport versionId={versionId} onClose={() => setImporting(false)} />}

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

      <div className="flex min-h-0 flex-1">
      <div className="lease-grid min-w-0 flex-1 p-2">
        <AgGridReact<Row>
          theme={theme}
          rowData={visibleRows}
          columnDefs={columnDefs}
          // every column gets the Excel-style checkbox filter
          defaultColDef={{ resizable: true, sortable: true, minWidth: 56, filter: ExcelFilter }}
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
        <RowForm
          key={selected.lineId}
          row={selected}
          year={year}
          staffDiscount={staffDiscount}
          mfPct={mfPct}
          isAdmin={isAdmin}
          onClose={() => {
            apiRef.current?.deselectAll();
            setSelected(null);
          }}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onSaveRera={async (min, max) => {
            const res = await saveRera(versionId, { propertyId: selected.propertyId, bedroom: selected.bedroom ?? '', min, max });
            if (res.error) return res.error;
            // every unit of the property with this RERA code was recalculated
            apiRef.current?.applyTransaction({ update: res.rows });
            setSelected((s) => (s ? (res.rows!.find((r) => r.lineId === s.lineId) ?? s) : s));
            refreshTotals();
            return null;
          }}
          onSave={(patch) => {
            queue.current.set(selected.lineId, { ...(queue.current.get(selected.lineId) ?? {}), ...patch });
            if (timer.current) clearTimeout(timer.current);
            return flush();
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
    </div>
  );
}

/** One short cell legend above the entry grid (.anh-legend-cells). */
function Legend() {
  return (
    <div className="anh-legend-cells border-b border-slate-200 bg-white px-4 py-2">
      <span>
        <i className="input" />
        To enter
      </span>
      <span>
        <i className="locked" />
        Locked (Oracle, calculated, read only)
      </span>
      <span>
        <em>Grey italic: calculated, until a value is typed</em>
      </span>
      <span className="anh-muted">Click a row to open its form · double-click a cell to edit</span>
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
