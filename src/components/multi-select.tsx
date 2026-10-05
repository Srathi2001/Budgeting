'use client';

// Dropdown filter with Excel-style checkbox list. An empty selection means "All".

import { useEffect, useRef, useState } from 'react';
import { CheckList, type CheckOption } from './check-list';

export function MultiSelect({
  label,
  options,
  value,
  onChange,
  width = 'w-44',
}: {
  label: string;
  options: CheckOption[];
  /** selected values; empty = all */
  value: string[];
  onChange: (v: string[]) => void;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);

  const openPicker = () => {
    // nothing selected = everything ticked, like Excel
    setDraft(new Set(value.length ? value : options.map((o) => o.value)));
    setOpen(true);
  };
  const apply = () => {
    const all = options.every((o) => draft.has(o.value));
    onChange(all ? [] : options.filter((o) => draft.has(o.value)).map((o) => o.value));
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const summary =
    value.length === 0 ? 'All' : value.length === 1 ? (options.find((o) => o.value === value[0])?.label ?? value[0]) : `${value.length} selected`;

  return (
    <div ref={box} className="relative flex items-center gap-2">
      <span className="text-slate-500">{label}</span>
      <button
        type="button"
        className={`input flex items-center justify-between gap-2 text-left ${width} ${value.length ? 'border-sky-400' : ''}`}
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-expanded={open}
      >
        <span className="truncate">{summary}</span>
        <span className="text-[10px] text-slate-500">{value.length ? '⏷' : '▾'}</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 rounded-lg border border-slate-300 bg-white p-3 shadow-2xl" style={{ marginLeft: 0 }}>
          <CheckList options={options} selected={draft} onChange={setDraft} autoFocus />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" className="btn btn-xs" onClick={() => { onChange([]); setOpen(false); }}>
              Clear filter
            </button>
            <span className="ml-auto" />
            <button type="button" className="btn btn-xs" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary btn-xs" disabled={draft.size === 0} onClick={apply}>
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
