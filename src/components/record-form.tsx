'use client';

// The side form of every input page, as the Lease Budget's row form (user decision 12-Oct-2026): the list
// on the left, one record on the right half with its fields grouped in sections, Save / Cancel at the
// bottom, ↑ ↓ to move between records, and a prompt before unsaved changes are dropped.

import { useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ui/dialog';
import { fmt } from '@/lib/format';

// left rule by cell state, never colour: ink where you enter values, gray for fixed, hairline for calculated
const TONE = { fixed: 'var(--control-border)', input: 'var(--ink)', calc: 'var(--line)' } as const;

export function FormSection({ title, tone = 'input', note, children }: { title: string; tone?: keyof typeof TONE; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-slate-200 bg-white" style={{ borderLeft: `3px solid ${TONE[tone]}` }}>
      <header className="flex items-baseline gap-2 border-b border-slate-200 px-3 py-1.5">
        <h3 className="text-[13px] font-bold text-slate-900">{title}</h3>
        {note && <span className="text-[11px] text-slate-500">{note}</span>}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

export const FormGrid = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 2xl:grid-cols-3">{children}</div>;

export function FormField({ label, hint, locked, wide, children }: { label: string; hint?: string; locked?: string | false; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`flex min-w-0 flex-col gap-0.5 ${wide ? 'col-span-full' : ''}`}>
      <span className="flex items-center gap-1 text-[11px] font-bold text-slate-900" title={locked || undefined}>
        {label}
        {locked && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-label="locked">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        )}
      </span>
      {children}
      {hint && <span className="text-[10px] text-slate-400">{hint}</span>}
    </label>
  );
}

const ro = 'field-locked w-full min-h-[30px] cursor-default truncate rounded-md px-2 py-1';
const box = (changed: boolean) => `input w-full ${changed ? 'ring-1 ring-sky-500' : ''}`;

/** a fixed value (never looks like an input) */
export const Show = ({ children, right }: { children: ReactNode; right?: boolean }) => (
  <div className={`${ro} ${right ? 'text-right tabular-nums' : ''}`}>{children === null || children === undefined || children === '' ? '—' : children}</div>
);

/** A record's draft: what was typed over the stored record; `dirty` counts the fields changed. */
export function useDraft<T extends object>(record: T) {
  const [draft, setDraft] = useState<Partial<T>>({});
  const rec = record as Record<string, unknown>;
  const d = draft as Record<string, unknown>;
  const changedKeys = Object.keys(d).filter((k) => JSON.stringify(d[k] ?? null) !== JSON.stringify(rec[k] ?? null));
  return {
    value: { ...record, ...draft } as T,
    set: <K extends keyof T>(k: K, v: T[K]) => setDraft((x) => ({ ...x, [k]: v })),
    changed: (k: keyof T) => changedKeys.includes(k as string),
    dirty: changedKeys.length,
    changes: Object.fromEntries(changedKeys.map((k) => [k, d[k]])) as Partial<T>,
    reset: () => setDraft({}),
  };
}

export function TextIn({ value, onChange, enabled, changed, placeholder }: { value: string | null; onChange: (v: string | null) => void; enabled: boolean; changed?: boolean; placeholder?: string }) {
  return enabled ? <input className={box(!!changed)} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value.trim() === '' ? null : e.target.value)} /> : <Show>{value}</Show>;
}

/** a number typed as text, read on leaving the field (1,234.56; blank = none); `pct`: shown and typed in % */
export function NumIn({ value, onChange, enabled, changed, placeholder, pct, int }: { value: number | null; onChange: (v: number | null) => void; enabled: boolean; changed?: boolean; placeholder?: string; pct?: boolean; int?: boolean }) {
  // percentages to 8 decimals of a % (insurance rates are small)
  const shown = (v: number | null) => (v === null ? '' : pct ? String(Math.round(v * 1e10) / 1e8) : String(v));
  const [text, setText] = useState(shown(value));
  const [bad, setBad] = useState(false);
  // the stored value changed (cancel, another record): show it (state adjusted while rendering, not in an effect)
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(shown(value));
  }
  if (!enabled) return <Show right>{value === null ? null : pct ? `${Math.round(value * 1e10) / 1e8}%` : int ? String(value) : fmt(value)}</Show>;
  return (
    <input
      className={`${box(!!changed)} text-right tabular-nums ${bad ? 'is-error' : ''}`}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        // left as shown: nothing changes (the shown text may be rounded)
        if (text === shown(value)) return setBad(false);
        const t = text.replace(/[,\s%]/g, '');
        if (t === '') return (setBad(false), onChange(null));
        const n = Number(t);
        if (!Number.isFinite(n) || (int && !Number.isInteger(n))) return setBad(true);
        setBad(false);
        onChange(pct ? n / 100 : n);
      }}
    />
  );
}

export function DateIn({ value, onChange, enabled, changed, placeholder }: { value: string | null; onChange: (v: string | null) => void; enabled: boolean; changed?: boolean; placeholder?: string | null }) {
  const dmy = (v: string | null) => (v ? new Date(`${v}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/ /g, '-') : null);
  if (!enabled) return <Show>{dmy(value ?? placeholder ?? null)}</Show>;
  return <input type="date" className={box(!!changed)} value={value ?? placeholder ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
}

export function SelectIn<V extends string>({ value, onChange, enabled, changed, options, blank }: { value: V | null; onChange: (v: V | null) => void; enabled: boolean; changed?: boolean; options: readonly { value: V; label: string }[]; blank?: string }) {
  if (!enabled) return <Show>{options.find((o) => o.value === value)?.label ?? value}</Show>;
  return (
    <select className={box(!!changed)} value={value ?? ''} onChange={(e) => onChange((e.target.value || null) as V | null)}>
      {blank !== undefined && <option value="">{blank}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function CheckIn({ value, onChange, enabled, label }: { value: boolean; onChange: (v: boolean) => void; enabled: boolean; label: string }) {
  return (
    <span className="flex min-h-[30px] items-center gap-2">
      <input type="checkbox" checked={value} disabled={!enabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="text-xs text-slate-600">{label}</span>
    </span>
  );
}

/** The page with its list on the left and, when a record is open, its side form on the right. */
export function ListAndForm({ form, children }: { form: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-auto">{children}</div>
      {form}
    </div>
  );
}

/**
 * Amounts of one record by row (its accounts, departments, entities …): the first column names the row, the
 * others are numbers, fixed (Show the value) or typed (NumIn). Optional total row.
 */
export function FormTable({ head, rows, foot }: { head: ReactNode[]; rows: { key: string; cells: ReactNode[] }[]; foot?: ReactNode[] }) {
  return (
    <table className="anh-grid w-full">
      <thead>
        <tr className="h1">
          {head.map((h, i) => (
            <th key={i} className={i ? 'anh-num' : undefined}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="child">
            {r.cells.map((c, i) => (
              <td key={i} className={i ? 'anh-num' : undefined} style={i ? { minWidth: '7.5rem' } : undefined}>
                {c}
              </td>
            ))}
          </tr>
        ))}
        {foot && (
          <tr className="total">
            {foot.map((c, i) => (
              <td key={i} className={i ? 'anh-num' : undefined}>
                {c}
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** a number in a FormTable cell that is not typed */
export const Num = ({ v }: { v: number | null | undefined }) => <span className="tabular-nums">{v === null || v === undefined ? '' : fmt(v)}</span>;

/** The side form: header (title, ↑ ↓, Close), flags, sections, save bar. */
export function RecordForm({
  title,
  subtitle,
  flags,
  canEdit,
  dirty,
  saving,
  error,
  onSave,
  onCancel,
  onClose,
  onPrev,
  onNext,
  onDelete,
  deleteLabel = 'Delete',
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  flags?: string[];
  canEdit: boolean;
  dirty: number;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
  children: ReactNode;
}) {
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const confirmLeave = (go?: () => void) => () => {
    if (!go) return;
    if (dirty) setLeaving(() => go);
    else go();
  };
  return (
    <aside aria-label="Record form" className="lease-form flex h-full min-h-0 w-1/2 shrink-0 flex-col border-l-2 border-sky-700 bg-slate-50 text-[13px]">
      <ConfirmDialog
        open={!!leaving}
        onOpenChange={(o) => !o && setLeaving(null)}
        title="Discard unsaved changes?"
        body="This record has changes that were not saved. Leaving it drops them."
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          leaving?.();
          return null;
        }}
      />
      <div className="flex items-start gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">{title}</div>
          {subtitle && (
            <div className="truncate text-xs text-slate-500">
              {subtitle}
              {!canEdit && ' · read only'}
            </div>
          )}
          <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-600" aria-label="Field legend">
            <span className="flex items-center gap-1">
              <i className="swatch input" /> To enter
            </span>
            <span className="flex items-center gap-1">
              <i className="swatch locked" /> Locked
            </span>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button className="btn btn-xs" disabled={!onPrev} onClick={confirmLeave(onPrev)} title="Previous">
            ↑
          </button>
          <button className="btn btn-xs" disabled={!onNext} onClick={confirmLeave(onNext)} title="Next">
            ↓
          </button>
          <button className="btn btn-xs" onClick={confirmLeave(onClose)}>
            Close
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {flags && flags.length > 0 && (
          <ul className="list-disc rounded-md border border-amber-200 bg-amber-50 py-1.5 pr-3 pl-7 text-xs text-amber-700">
            {flags.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {children}
        {canEdit && onDelete && (
          <div className="pt-1">
            <button className="btn btn-xs" onClick={onDelete}>
              {deleteLabel}
            </button>
          </div>
        )}
      </div>
      {canEdit && (
        <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-4 py-2">
          <span className={`text-xs ${error ? 'text-red-600' : 'text-slate-500'}`}>{error ?? (dirty ? `${dirty} unsaved change${dirty > 1 ? 's' : ''}` : 'No changes')}</span>
          <button className="btn ml-auto" disabled={!dirty || saving} onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!dirty || saving} onClick={onSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </aside>
  );
}
