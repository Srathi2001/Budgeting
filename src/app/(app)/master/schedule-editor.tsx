'use client';

import { useState } from 'react';
import type { DerivedContract, ScheduleItem } from '@/lib/budget/master-types';
import { fmt } from '@/lib/format';

const SOURCE: Record<DerivedContract['scheduleSource'], { label: string; cls: string }> = {
  ACTUAL: { label: 'Actual', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  CUSTOM: { label: 'Edited', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  EQUAL: { label: 'Equal cheques', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

const dmy = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/** Equal cheques, first on the start date, then every 370 / n days (same rule as the engine). */
function spread(start: string, rent: number, n: number): ScheduleItem[] {
  const base = Date.parse(`${start}T00:00:00Z`);
  const each = Math.round((rent / n) * 100) / 100;
  return Array.from({ length: n }, (_, k) => ({
    date: new Date(base + Math.floor((k * 370) / n) * 86_400_000).toISOString().slice(0, 10),
    amount: k === n - 1 ? Math.round((rent - each * (n - 1)) * 100) / 100 : each,
  }));
}

export function ScheduleEditor({
  title,
  contract,
  year,
  editable,
  overrideNote,
  onSave,
}: {
  title: string;
  contract: DerivedContract;
  year: number;
  editable: boolean;
  /** Shown under the title, e.g. where the actual schedule will come from. */
  overrideNote?: string;
  /** null resets to equal cheques */
  onSave: (items: ScheduleItem[] | null) => void;
}) {
  const [draft, setDraft] = useState<ScheduleItem[] | null>(null);
  const items = draft ?? contract.schedule;
  const total = items.reduce((s, q) => s + (Number(q.amount) || 0), 0);
  const diff = total - contract.rent;
  const src = SOURCE[contract.scheduleSource];
  const inYear = (d: string) => d.startsWith(String(year));

  return (
    <div className="w-[300px] shrink-0 rounded-md border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
        <span className="text-xs font-semibold text-slate-700">{title}</span>
        <span className={`rounded px-1.5 py-px text-[10px] font-medium ring-1 ring-inset ${src.cls}`}>{src.label}</span>
        {editable && !draft && (
          <button className="ml-auto text-xs text-sky-700 hover:underline" onClick={() => setDraft(contract.schedule.map((q) => ({ ...q })))}>
            Edit
          </button>
        )}
      </div>
      {overrideNote && <div className="border-b border-slate-100 px-3 py-1 text-[11px] text-slate-500">{overrideNote}</div>}
      <table className="tbl tbl-compact">
        <thead>
          <tr>
            <th className="w-8 text-right">#</th>
            <th>Cheque date</th>
            <th className="text-right">Amount (ex VAT)</th>
            {draft && <th className="w-6" />}
          </tr>
        </thead>
        <tbody>
          {items.map((q, i) => (
            <tr key={i} className={inYear(q.date) ? '' : 'text-slate-400'}>
              <td className="text-right tabular-nums">{i + 1}</td>
              <td>
                {draft ? (
                  <input
                    type="date"
                    className="cell-edit"
                    value={q.date}
                    onChange={(e) => setDraft(items.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))}
                  />
                ) : (
                  dmy(q.date)
                )}
              </td>
              <td className="text-right tabular-nums">
                {draft ? (
                  <input
                    className="cell-edit text-right"
                    value={q.amount}
                    onChange={(e) =>
                      setDraft(items.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value.replace(/,/g, '')) || 0 } : x)))
                    }
                  />
                ) : (
                  fmt(q.amount)
                )}
              </td>
              {draft && (
                <td>
                  <button className="text-slate-400 hover:text-red-600" title="Remove" onClick={() => setDraft(items.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </td>
              )}
            </tr>
          ))}
          <tr className="tbl-total">
            <td />
            <td>Total</td>
            <td className={`text-right tabular-nums ${Math.abs(diff) > 1 ? 'text-red-600' : ''}`} title={Math.abs(diff) > 1 ? `Rent is ${fmt(contract.rent)}` : ''}>
              {fmt(total)}
            </td>
            {draft && <td />}
          </tr>
        </tbody>
      </table>
      {draft && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 px-3 py-2 text-xs">
          <button
            className="btn btn-xs"
            onClick={() => setDraft([...items, { date: items.at(-1)?.date ?? contract.start ?? `${year}-01-01`, amount: 0 }])}
          >
            + Cheque
          </button>
          <span className="text-slate-500">Spread equally:</span>
          {[1, 2, 4, 6, 12].map((n) => (
            <button key={n} className="btn btn-xs" onClick={() => contract.start && setDraft(spread(contract.start, contract.rent, n))}>
              {n}
            </button>
          ))}
          <span className="ml-auto" />
          <button className="btn btn-xs" onClick={() => setDraft(null)}>
            Cancel
          </button>
          <button
            className="btn-primary btn-xs"
            onClick={() => {
              onSave(items.filter((q) => q.date).sort((a, b) => a.date.localeCompare(b.date)));
              setDraft(null);
            }}
          >
            Save
          </button>
        </div>
      )}
      {editable && !draft && contract.scheduleSource !== 'EQUAL' && (
        <div className="border-t border-slate-200 px-3 py-1.5 text-right">
          <button className="text-xs text-slate-600 hover:text-red-600 hover:underline" onClick={() => onSave(null)}>
            Reset to equal cheques
          </button>
        </div>
      )}
    </div>
  );
}
