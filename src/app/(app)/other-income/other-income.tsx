'use client';

import { useMemo, useState } from 'react';
import type { FeeKey, OtherIncomeRow } from '@/lib/budget/other-income';
import { fmt } from '@/lib/format';
import { MultiSelect } from '@/components/multi-select';

const FEES: { key: FeeKey; label: string }[] = [
  { key: 'maintenance', label: 'Maintenance fee' },
  { key: 'utility', label: 'Utility fee' },
  { key: 'carPark', label: 'Additional car park' },
];

export function OtherIncome({ rows, versionName, year }: { rows: OtherIncomeRow[]; versionName: string; year: number }) {
  const [bu, setBu] = useState<string[]>([]);
  const [pm, setPm] = useState<string[]>([]);
  const [hideEmpty, setHideEmpty] = useState(true);
  const bus = [...new Set(rows.map((r) => r.bu))].sort();
  const pms = [...new Set(rows.map((r) => r.pm))].sort();
  const total = (r: OtherIncomeRow) => FEES.reduce((s, f) => s + r.fees[f.key].amount, 0);

  const view = useMemo(
    () =>
      rows.filter(
        (r) => (bu.length === 0 || bu.includes(r.bu)) && (pm.length === 0 || pm.includes(r.pm)) && (!hideEmpty || total(r) > 0),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, bu, pm, hideEmpty],
  );
  const sum = (f: (r: OtherIncomeRow) => number) => view.reduce((s, r) => s + f(r), 0);
  const mfPct = (amount: number, rent: number) => (rent > 0 ? `${((amount / rent) * 100).toFixed(1)}%` : '');

  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="page-title">Other Income</h1>
        <p className="page-sub">
          {versionName} · by property · charges billed with the current leases besides rent (Oracle import), on a 12-month basis · not part of rent
          revenue
        </p>
      </header>

      <div className="card flex flex-wrap items-center gap-3 px-3 py-2 text-[13px]">
        <MultiSelect label="Business unit" value={bu} onChange={setBu} options={bus.map((b) => ({ value: b, label: b }))} />
        <MultiSelect label="Property manager" value={pm} onChange={setPm} options={pms.map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))} />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Only properties with other income
        </label>
        <span className="ml-auto text-xs text-slate-500">{view.length} properties</span>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-700">
        Figures are what the <b>current leases</b> carry today. How to project them into the {year} budget (renewals, new tenants, vacancy) is still to be
        agreed, so there is no {year}B column yet.
      </div>

      <div className="frame">
        <table className="tbl">
          <thead>
            <tr>
              <th>Property</th>
              <th>Code</th>
              <th>BU</th>
              <th>PM</th>
              <th className="num">Current leases</th>
              {FEES.map((f) => (
                <th key={f.key} className="num">
                  {f.label}
                </th>
              ))}
              <th className="num">Total other income</th>
              <th className="num" title="Maintenance fee as a share of the rent of the leases that pay it">
                Maint. fee % of rent
              </th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr key={r.propertyId}>
                <td>{r.name}</td>
                <td className="muted">{r.code}</td>
                <td>{r.bu}</td>
                <td>{r.pm}</td>
                <td className="num">{r.leases}</td>
                {FEES.map((f) => (
                  <td key={f.key} className="num" title={r.fees[f.key].leases ? `${r.fees[f.key].leases} lease(s)` : undefined}>
                    {r.fees[f.key].amount ? fmt(r.fees[f.key].amount) : ''}
                    {r.fees[f.key].leases > 0 && <span className="ml-1 text-[10px] text-slate-400">({r.fees[f.key].leases})</span>}
                  </td>
                ))}
                <td className="num font-semibold">{total(r) ? fmt(total(r)) : ''}</td>
                <td className="num muted">{mfPct(r.fees.maintenance.amount, r.rentWithMaintenance)}</td>
              </tr>
            ))}
            <tr className="tbl-total">
              <td>Total</td>
              <td />
              <td />
              <td />
              <td className="num">{fmt(sum((r) => r.leases))}</td>
              {FEES.map((f) => (
                <td key={f.key} className="num">
                  {fmt(sum((r) => r.fees[f.key].amount))}
                  <span className="ml-1 text-[10px] text-slate-400">({fmt(sum((r) => r.fees[f.key].leases))})</span>
                </td>
              ))}
              <td className="num">{fmt(sum(total))}</td>
              <td className="num">{mfPct(sum((r) => r.fees.maintenance.amount), sum((r) => r.rentWithMaintenance))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">(n) = number of leases carrying the charge. Amounts are annualised from the current contract year.</p>
    </div>
  );
}
