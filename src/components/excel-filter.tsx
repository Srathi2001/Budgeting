'use client';

// Excel-style column filter for AG Grid Community: sort, search, (Select All), one checkbox per
// distinct value (as displayed), (Blanks), OK / Cancel / Clear. Values offered are those of rows
// that pass the other columns' filters, like Excel.

import { useCallback, useMemo, useRef, useState } from 'react';
import { useGridFilter, type CustomFilterProps } from 'ag-grid-react';
import type { IAfterGuiAttachedParams, IDoesFilterPassParams, IRowNode } from 'ag-grid-community';
import { BLANK, CheckList, type CheckOption } from './check-list';

export interface ExcelFilterModel {
  values: string[];
}

export function ExcelFilter(props: CustomFilterProps<unknown, unknown, ExcelFilterModel>) {
  const { api, column, model, onModelChange, doesRowPassOtherFilter } = props;
  const hide = useRef<(() => void) | undefined>(undefined);
  const [options, setOptions] = useState<CheckOption[]>([]);
  const [draft, setDraft] = useState<Set<string>>(new Set());

  /** the value as the user sees it in the cell */
  const display = useCallback(
    (node: IRowNode) => {
      const v = api.getCellValue({ rowNode: node, colKey: column, useFormatter: true });
      const s = v === null || v === undefined ? '' : String(v).trim();
      return s === '' ? BLANK : s;
    },
    [api, column],
  );

  const selectedSet = useMemo(() => (model ? new Set(model.values) : null), [model]);

  const doesFilterPass = useCallback(
    (p: IDoesFilterPassParams) => (selectedSet ? selectedSet.has(display(p.node)) : true),
    [selectedSet, display],
  );

  const load = useCallback(() => {
    const counts = new Map<string, { n: number; raw: unknown }>();
    api.forEachNode((node) => {
      if (!node.data || !doesRowPassOtherFilter(node)) return;
      const d = display(node);
      const c = counts.get(d);
      if (c) c.n++;
      else counts.set(d, { n: 1, raw: api.getCellValue({ rowNode: node, colKey: column }) });
    });
    const opts = [...counts.entries()]
      .sort(([a, x], [b, y]) => {
        if (a === BLANK) return 1;
        if (b === BLANK) return -1;
        if (typeof x.raw === 'number' && typeof y.raw === 'number') return x.raw - y.raw;
        return String(x.raw ?? a).localeCompare(String(y.raw ?? b), undefined, { numeric: true });
      })
      .map(([value, c]) => ({ value, label: value === BLANK ? '(Blanks)' : value, count: c.n }));
    setOptions(opts);
    setDraft(new Set(model ? model.values.filter((v) => counts.has(v)) : opts.map((o) => o.value)));
  }, [api, column, display, doesRowPassOtherFilter, model]);

  useGridFilter({
    doesFilterPass,
    afterGuiAttached: (params?: IAfterGuiAttachedParams) => {
      hide.current = params?.hidePopup;
      load();
    },
  });

  const close = () => hide.current?.();
  const apply = () => {
    const all = options.length > 0 && options.every((o) => draft.has(o.value));
    onModelChange(all ? null : { values: [...draft] });
    close();
  };
  const sort = (dir: 'asc' | 'desc') => {
    api.applyColumnState({ state: [{ colId: column.getColId(), sort: dir }], defaultState: { sort: null } });
    close();
  };

  return (
    <div className="excel-filter p-3 text-[13px]" onKeyDown={(e) => e.key === 'Enter' && draft.size > 0 && apply()}>
      <div className="mb-2 flex flex-col gap-0.5">
        <button type="button" className="rounded px-2 py-1 text-left text-slate-700 hover:bg-slate-100" onClick={() => sort('asc')}>
          ↑ Sort smallest to largest / A → Z
        </button>
        <button type="button" className="rounded px-2 py-1 text-left text-slate-700 hover:bg-slate-100" onClick={() => sort('desc')}>
          ↓ Sort largest to smallest / Z → A
        </button>
      </div>
      <CheckList options={options} selected={draft} onChange={setDraft} autoFocus />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="btn btn-xs"
          disabled={!model}
          onClick={() => {
            onModelChange(null);
            close();
          }}
        >
          Clear filter
        </button>
        <span className="ml-auto" />
        <button type="button" className="btn btn-xs" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn-primary btn-xs" disabled={draft.size === 0} onClick={apply}>
          OK
        </button>
      </div>
    </div>
  );
}
