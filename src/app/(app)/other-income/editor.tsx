'use client';

import { useState } from 'react';
import { fmt, MONTHS, sum } from '@/lib/format';
import { saveOtherIncome } from './actions';

export interface GlLine {
  code: string;
  name: string;
  owner: string | null;
  auto: boolean;
  months: number[];
}

const parse = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function OtherIncomeEditor({
  versionId,
  propertyId,
  year,
  lines: initial,
  editable,
}: {
  versionId: number;
  propertyId: number;
  year: number;
  lines: GlLine[];
  editable: boolean;
}) {
  const [lines, setLines] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);

  const update = (code: string, months: number[]) => {
    setLines((ls) => ls.map((l) => (l.code === code ? { ...l, months } : l)));
    saveOtherIncome({ versionId, propertyId, glCode: code, months })
      .then((r) => setMsg(r.error ?? 'Saved'))
      .catch((e: Error) => setMsg(e.message));
  };

  const total = MONTHS.map((_, i) => sum(lines.map((l) => l.months[i])));

  return (
    <div className="frame">
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2 text-xs text-slate-500">
        {editable ? 'Type monthly amounts, or an annual amount in Total to spread it evenly.' : 'Read only.'}
        {msg && <span className="ml-auto">{msg}</span>}
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>GL</th>
            <th>Account</th>
            {MONTHS.map((m) => (
              <th key={m} className="num">
                {m}-{String(year).slice(2)}
              </th>
            ))}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.code} className={l.auto ? 'bg-slate-50' : ''}>
              <td className="text-slate-500">{l.code}</td>
              <td>
                {l.name}
                {l.auto && <span className="ml-2 text-xs text-sky-700">calculated</span>}
              </td>
              {l.months.map((v, i) => (
                <td key={i} className="num">
                  {editable && !l.auto ? (
                    <input
                      className="cell-edit text-right"
                      defaultValue={v ? String(v) : ''}
                      key={`${l.code}-${i}-${v}`}
                      onBlur={(e) => {
                        const n = parse(e.target.value);
                        if (n !== v) update(l.code, l.months.map((x, j) => (j === i ? n : x)));
                      }}
                    />
                  ) : (
                    fmt(v)
                  )}
                </td>
              ))}
              <td className="num font-semibold">
                {editable && !l.auto ? (
                  <input
                    className="cell-edit text-right font-semibold"
                    defaultValue={sum(l.months) ? String(Math.round(sum(l.months) * 100) / 100) : ''}
                    key={`${l.code}-t-${sum(l.months)}`}
                    title="Enter an annual amount to spread evenly across 12 months"
                    onBlur={(e) => {
                      const n = parse(e.target.value);
                      if (Math.abs(n - sum(l.months)) > 0.005) {
                        const each = Math.round((n / 12) * 100) / 100;
                        const months = Array(12).fill(each);
                        months[11] = Math.round((n - each * 11) * 100) / 100;
                        update(l.code, months);
                      }
                    }}
                  />
                ) : (
                  fmt(sum(l.months))
                )}
              </td>
            </tr>
          ))}
          <tr className="tbl-total">
            <td colSpan={2}>Total other income</td>
            {total.map((v, i) => (
              <td key={i} className="num">
                {fmt(v)}
              </td>
            ))}
            <td className="num">{fmt(sum(total))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
