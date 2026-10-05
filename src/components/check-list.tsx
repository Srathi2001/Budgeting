'use client';

// Excel-style value picker: search box, "(Select All)" over the visible values, one checkbox per value.

import { useMemo, useState } from 'react';

export interface CheckOption {
  value: string;
  label: string;
  count?: number;
}

export const BLANK = '\u0000blank';
const RENDER_LIMIT = 400;

export function CheckList({
  options,
  selected,
  onChange,
  autoFocus,
}: {
  options: CheckOption[];
  /** checked values */
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.label.toLowerCase().includes(s)) : options;
  }, [options, q]);
  const allVisibleChecked = visible.length > 0 && visible.every((o) => selected.has(o.value));
  const someVisibleChecked = visible.some((o) => selected.has(o.value));

  const toggleAll = () => {
    const next = new Set(selected);
    if (allVisibleChecked) visible.forEach((o) => next.delete(o.value));
    else visible.forEach((o) => next.add(o.value));
    onChange(next);
  };
  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  };

  return (
    <div className="flex w-64 flex-col gap-2">
      <input
        autoFocus={autoFocus}
        className="input w-full"
        placeholder="Search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <div className="max-h-64 overflow-auto rounded-md border border-slate-200 bg-slate-50 py-1 text-[13px]">
        <label className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-slate-100">
          <input
            type="checkbox"
            checked={allVisibleChecked}
            ref={(el) => {
              if (el) el.indeterminate = !allVisibleChecked && someVisibleChecked;
            }}
            onChange={toggleAll}
          />
          <span className="font-medium text-slate-800">{q ? '(Select All Search Results)' : '(Select All)'}</span>
        </label>
        {visible.slice(0, RENDER_LIMIT).map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-slate-100" title={o.label}>
            <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} />
            <span className={`min-w-0 flex-1 truncate ${o.value === BLANK ? 'text-slate-500 italic' : 'text-slate-700'}`}>{o.label}</span>
            {o.count !== undefined && <span className="text-[11px] text-slate-500 tabular-nums">{o.count}</span>}
          </label>
        ))}
        {visible.length > RENDER_LIMIT && (
          <div className="px-2 py-1 text-[11px] text-slate-500">
            {visible.length - RENDER_LIMIT} more — type to narrow the list
          </div>
        )}
        {!visible.length && <div className="px-2 py-1 text-xs text-slate-500">No matches</div>}
      </div>
    </div>
  );
}
