'use client';

import { useState } from 'react';
import Link from 'next/link';
import { fmt, pct, sum } from '@/lib/format';
import { saveComparative, saveNote } from './actions';

export interface AnalysisRow {
  propertyId: number;
  code: string;
  name: string;
  bu: string;
  kind: 'BUILDING' | 'CAMP' | 'MALL';
  units: string;
  budget: number;
  values: Record<string, number | null>;
  vacancyLossCalc: number;
  vacancyLossOverride: number | null;
  comment: string | null;
  canComment: boolean;
}

const num = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ''));
  return s.trim() === '' || !Number.isFinite(n) ? null : n;
};

export function AnalysisTable({
  versionId,
  year,
  rows,
  labels: initialLabels,
  base,
  finance,
}: {
  versionId: number;
  year: number;
  rows: AnalysisRow[];
  labels: string[];
  base: string | null;
  finance: boolean;
}) {
  const [labels, setLabels] = useState(initialLabels);
  const [newLabel, setNewLabel] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const others = labels.filter((l) => l !== base);
  const budgetLabel = `${year}B`;

  const ordinary = rows.filter((r) => r.kind !== 'MALL');
  const mall = rows.filter((r) => r.kind === 'MALL');
  const vl = (r: AnalysisRow) => r.vacancyLossOverride ?? r.vacancyLossCalc;

  const totals = (rs: AnalysisRow[]) => {
    const t: Record<string, number> = { budget: sum(rs.map((r) => r.budget)), vl: sum(rs.map(vl)) };
    for (const l of labels) t[l] = sum(rs.map((r) => r.values[l] ?? 0));
    return t;
  };

  const report = (p: Promise<{ error?: string }>) =>
    p.then((r) => setMsg(r.error ?? 'Saved')).catch((e: Error) => setMsg(e.message));

  const renderRow = (r: AnalysisRow, i: number) => {
    const b = base ? r.values[base] : null;
    const esc = b !== null ? r.budget - b : null;
    return (
      <tr key={r.propertyId} className="align-top">
        <td className="num text-slate-500">{i + 1}</td>
        <td className="num">{r.units}</td>
        <td>{r.bu}</td>
        <td className="text-slate-500">{r.code}</td>
        <td>
          <Link href={`/master?p=${r.propertyId}`} className="hover:text-sky-700 hover:underline">
            {r.name}
          </Link>
        </td>
        <td className="num font-semibold">{fmt(r.budget)}</td>
        {base && compCell(r, base)}
        <td className={`num ${esc !== null && esc < 0 ? 'text-red-600' : ''}`}>{fmt(esc)}</td>
        <td className="num">{b ? pct((esc ?? 0) / b) : ''}</td>
        {others.map((l) => compCell(r, l))}
        <td className="num">
          {r.canComment ? (
            <input
              className="input w-28 text-right"
              defaultValue={r.vacancyLossOverride ?? ''}
              placeholder={fmt(r.vacancyLossCalc)}
              title="Blank = calculated from vacancy gaps"
              onBlur={(e) => {
                const v = num(e.target.value);
                if (v !== r.vacancyLossOverride)
                  report(saveNote({ versionId, propertyId: r.propertyId, comment: r.comment, vacancyLossOverride: v }));
              }}
            />
          ) : (
            fmt(vl(r))
          )}
        </td>
        <td className="num">{r.budget ? pct(vl(r) / r.budget, 2) : ''}</td>
        <td className="min-w-80 whitespace-normal">
          {r.canComment ? (
            <textarea
              className="input w-full text-xs"
              rows={1}
              defaultValue={r.comment ?? ''}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== r.comment)
                  report(saveNote({ versionId, propertyId: r.propertyId, comment: v, vacancyLossOverride: r.vacancyLossOverride }));
              }}
            />
          ) : (
            <span className="text-xs">{r.comment}</span>
          )}
        </td>
      </tr>
    );
  };

  const compCell = (r: AnalysisRow, label: string) =>
    finance ? (
      <td key={label} className="num">
        <input
          className="input w-28 text-right"
          defaultValue={r.values[label] ?? ''}
          onBlur={(e) => {
            const v = num(e.target.value);
            if (v !== r.values[label]) report(saveComparative({ versionId, propertyId: r.propertyId, label, amount: v }));
          }}
        />
      </td>
    ) : (
      <td key={label} className="num">{fmt(r.values[label])}</td>
    );

  const totalRow = (label: string, t: Record<string, number>) => (
    <tr key={label} className="total">
      <td colSpan={5}>{label}</td>
      <td className="num">{fmt(t.budget)}</td>
      {base && <td className="num">{fmt(t[base])}</td>}
      <td className="num">{base ? fmt(t.budget - t[base]) : ''}</td>
      <td className="num">{base && t[base] ? pct((t.budget - t[base]) / t[base]) : ''}</td>
      {others.map((l) => (
        <td key={l} className="num">
          {fmt(t[l])}
        </td>
      ))}
      <td className="num">{fmt(t.vl)}</td>
      <td className="num">{t.budget ? pct(t.vl / t.budget, 2) : ''}</td>
      <td />
    </tr>
  );

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold">Revenue analysis</h1>
          <p className="text-sm text-slate-500">Budget {year} by property · AED</p>
        </div>
        <div className="ml-6 flex items-center gap-1 text-sm">
          <span className="text-slate-500">Escalation vs</span>
          {labels.map((l) => (
            <Link key={l} href={`/analysis?base=${l}`} className={l === base ? 'btn-primary' : 'btn'}>
              {l}
            </Link>
          ))}
        </div>
        {finance && (
          <form
            className="ml-auto flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const l = newLabel.trim().toUpperCase();
              if (/^\d{4}[A-Z]+$/.test(l) && !labels.includes(l) && l !== budgetLabel) setLabels([...labels, l]);
              setNewLabel('');
            }}
          >
            <input
              className="input w-36"
              placeholder="New column e.g. 2026F"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <button className="btn">Add comparative</button>
          </form>
        )}
        <a className="btn" href="/api/export/analysis">
          Export to Excel
        </a>
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </header>

      <div className="card overflow-auto">
        <table className="table-fin">
          <thead>
            <tr>
              <th className="num">S.N.</th>
              <th className="num">Units</th>
              <th>BU</th>
              <th>Code</th>
              <th>Property</th>
              <th className="num">{budgetLabel}</th>
              {base && <th className="num">{base}</th>}
              <th className="num">Escalation</th>
              <th className="num">Esc %</th>
              {others.map((l) => (
                <th key={l} className="num">
                  {l}
                </th>
              ))}
              <th className="num">Vacancy loss</th>
              <th className="num">% of {budgetLabel}</th>
              <th>Comments ({budgetLabel} vs {base ?? '—'})</th>
            </tr>
          </thead>
          <tbody>
            {ordinary.map((r, i) => renderRow(r, i))}
            {mall.length > 0 && totalRow('Total (excl. Mall)', totals(ordinary))}
            {mall.map((r, i) => renderRow(r, ordinary.length + i))}
            {totalRow('Total revenue', totals(rows))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Vacancy loss is calculated from the gap between a lease ending and the next tenant starting (grey). Type a figure to override it.
      </p>
    </div>
  );
}
