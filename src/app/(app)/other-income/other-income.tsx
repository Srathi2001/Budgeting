'use client';

// Other income by property × GL account. Actuals come from the GL (locked), the Oct–Dec forecast and
// the budget are typed by the property manager (General rows: Finance), the maintenance service fee
// budget comes from the Lease Budget.

import { Fragment, useMemo, useState, useTransition } from 'react';
import { fmt } from '@/lib/format';
import { MultiSelect } from '@/components/multi-select';
import {
  OI_ACCOUNT,
  OI_ACCOUNTS,
  OI_COLUMNS,
  oiCell,
  oiInput,
  oiLabel,
  type OiBlock,
  type OiChange,
  type OiColumn,
  type OiPeriod,
} from '@/lib/budget/other-income-types';
import { saveOtherIncomeCells } from './actions';

const key = (scope: string, account: string, period: string) => `${scope}|${account}|${period}`;
const omit = (d: Record<string, string>, k: string) => Object.fromEntries(Object.entries(d).filter(([x]) => x !== k));

function parseAmount(s: string): number | null | 'bad' {
  const t = s.replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 'bad';
}

export function OtherIncome({
  blocks: initial,
  versionId,
  versionName,
  year,
  locked,
  mfPct,
}: {
  blocks: OiBlock[];
  versionId: number;
  versionName: string;
  year: number;
  locked: boolean;
  mfPct: number;
}) {
  const [blocks, setBlocks] = useState(initial);
  const [bu, setBu] = useState<string[]>([]);
  const [pm, setPm] = useState<string[]>([]);
  const [allAccounts, setAllAccounts] = useState(false);
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [bad, setBad] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ kind: 'idle' });
  const [, start] = useTransition();

  const bus = [...new Set(initial.map((b) => `${b.buCode} ${b.buName}`))].sort();
  const pms = [...new Set(initial.map((b) => b.pm).filter((p): p is string => !!p))].sort();

  /** accounts shown in a block */
  const accountsOf = (b: OiBlock) =>
    OI_ACCOUNTS.filter((a) => {
      const hasData = OI_COLUMNS.some((c) => oiCell(b, a.code, c) !== null) || OI_COLUMNS.some((c) => dirty.has(key(b.scope, a.code, c)));
      if (hasData) return true;
      return allAccounts && (b.kind === 'G' ? !!a.general : !a.general);
    });

  const view = useMemo(() => {
    const q = search.trim().toLowerCase();
    return blocks.filter(
      (b) =>
        (bu.length === 0 || bu.includes(`${b.buCode} ${b.buName}`)) &&
        (pm.length === 0 || (b.pm !== null && pm.includes(b.pm))) &&
        (!q || b.code.toLowerCase().includes(q) || b.name.toLowerCase().includes(q)) &&
        accountsOf(b).length > 0,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, bu, pm, search, allAccounts, dirty]);

  const total = (bs: OiBlock[], c: OiColumn, account?: string) => {
    let s = 0;
    let any = false;
    for (const b of bs)
      for (const a of account ? [account] : OI_ACCOUNTS.map((x) => x.code)) {
        const v = oiCell(b, a, c);
        if (v !== null) {
          s += v;
          any = true;
        }
      }
    return any ? s : null;
  };

  const commit = (b: OiBlock, account: string, period: OiPeriod) => {
    const k = key(b.scope, account, period);
    if (!(k in drafts)) return;
    const parsed = parseAmount(drafts[k]);
    if (parsed === 'bad') {
      setBad((s) => new Set(s).add(k));
      setStatus({ kind: 'error', text: `${b.code} ${OI_ACCOUNT.get(account)?.name}: not a number` });
      return;
    }
    setBad((s) => {
      const n = new Set(s);
      n.delete(k);
      return n;
    });
    const before = b.values[account]?.[period] ?? null;
    setDrafts((d) => omit(d, k));
    if (parsed === before) return;
    // show it straight away; the server confirms
    setBlocks((all) => all.map((x) => (x.scope === b.scope ? { ...x, values: { ...x.values, [account]: { ...x.values[account], [period]: parsed } } } : x)));
    setDirty((s) => new Set(s).add(k));
    setStatus({ kind: 'saving' });
    const change: OiChange = { scope: b.scope, account, period, amount: parsed };
    start(async () => {
      const res = await saveOtherIncomeCells(versionId, [change]);
      setDirty((s) => {
        const n = new Set(s);
        n.delete(k);
        return n;
      });
      if (res.errors.length) {
        // put the stored value back
        setBlocks((all) => all.map((x) => (x.scope === b.scope ? { ...x, values: { ...x.values, [account]: { ...x.values[account], [period]: before } } } : x)));
        setStatus({ kind: 'error', text: res.errors[0] });
      } else setStatus({ kind: 'saved', text: 'Saved' });
    });
  };

  const cell = (b: OiBlock, account: string, c: OiColumn) => {
    const v = oiCell(b, account, c);
    const k = key(b.scope, account, c);
    const canType = !locked && b.editable && oiInput(b, account, c);
    if (canType) {
      const period = c as OiPeriod;
      return (
        <td key={c} className={`anh-num input${dirty.has(k) ? ' is-dirty' : ''}${bad.has(k) ? ' is-error' : ''}`}>
          <input
            aria-label={`${b.code} ${OI_ACCOUNT.get(account)?.name} ${oiLabel(c, year)}`}
            inputMode="decimal"
            value={k in drafts ? drafts[k] : v === null ? '' : fmt(v)}
            onFocus={(e) => {
              setDrafts((d) => ({ ...d, [k]: v === null ? '' : String(v) }));
              requestAnimationFrame(() => e.target.select());
            }}
            onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))}
            onBlur={() => commit(b, account, period)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setDrafts((d) => omit(d, k));
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </td>
      );
    }
    const calc = c === 'F' || (c === 'B' && OI_ACCOUNT.get(account)?.calc === 'MF' && b.kind === 'P');
    return (
      <td key={c} className={`anh-num ${calc ? 'calc' : c === 'OD' || c === 'B' ? '' : 'locked'}`}>
        {fmt(v)}
      </td>
    );
  };

  const byBu = useMemo(() => {
    const m = new Map<string, OiBlock[]>();
    for (const b of view) m.set(b.buCode, [...(m.get(b.buCode) ?? []), b]);
    return [...m.values()];
  }, [view]);

  const cols = OI_COLUMNS.length + 4;
  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="page-title">Other Income</h1>
        <p className="page-sub">{versionName} · by property and GL account</p>
      </header>

      <div className="card flex flex-wrap items-center gap-3 px-3 py-2 text-[13px]">
        <MultiSelect label="Business unit" value={bu} onChange={setBu} options={bus.map((b) => ({ value: b, label: b }))} />
        <MultiSelect label="Property manager" value={pm} onChange={setPm} options={pms.map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))} />
        <input className="input w-56" placeholder="Property" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={allAccounts} onChange={(e) => setAllAccounts(e.target.checked)} /> All accounts
        </label>
        <span className="ml-auto text-xs text-slate-500">
          {status.kind === 'saving' ? 'Saving…' : status.kind === 'error' ? <span className="text-red-600">{status.text}</span> : status.text}
        </span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="anh-legend-cells" aria-label="Cell legend">
          <span>
            <i className="input" />
            Editable
          </span>
          <span>
            <i className="locked" />
            Actual
          </span>
          <span>
            <i className="calc" />
            Calculated
          </span>
          <span>
            <i className="dirty" />
            Unsaved
          </span>
        </div>
        <span className="anh-muted text-xs">AED</span>
      </div>

      <div className="anh-grid-wrap max-h-[calc(100vh-15rem)]">
        <table className="anh-grid">
          <thead>
            <tr className="h2">
              <th colSpan={4} />
              <th colSpan={3} style={{ textAlign: 'center' }}>
                Actual
              </th>
              <th colSpan={2} style={{ textAlign: 'center' }}>
                Forecast {year - 1}
              </th>
              <th className="anh-num">Budget</th>
            </tr>
            <tr className="h1">
              <th>Account</th>
              <th>BU</th>
              <th>GL</th>
              <th>LL / ANPM</th>
              {OI_COLUMNS.map((c) => (
                <th key={c} className="anh-num" title={c === 'B' ? `Maintenance service fee: ${Math.round(mfPct * 100)}% of renewal / new-tenant rent, from the Lease Budget` : undefined}>
                  {c === 'F' && <span className="fx">fx</span>}
                  {oiLabel(c, year)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byBu.map((group) => (
              <Fragment key={group[0].buCode}>
                {group.map((b) => (
                  <Fragment key={b.scope}>
                    <tr className="section">
                      <td colSpan={cols}>
                        {b.kind === 'G' ? `General · ${b.buCode} ${b.buName}` : `${b.code} · ${b.name}`}
                        {b.pm && <span className="ml-2 font-normal text-slate-500">{b.pm}</span>}
                      </td>
                    </tr>
                    {accountsOf(b).map((a) => (
                      <tr key={a.code} className="child">
                        <td>{a.name}</td>
                        <td title={b.buName}>{b.buCode}</td>
                        <td>
                          <span className="anh-code">{a.code}</span>
                        </td>
                        <td>{a.side === 'LL' ? 'Landlord' : (a.side ?? '')}</td>
                        {OI_COLUMNS.map((c) => cell(b, a.code, c))}
                      </tr>
                    ))}
                    <tr className="subtotal">
                      <td>Total {b.kind === 'G' ? 'General' : b.code}</td>
                      <td>{b.buCode}</td>
                      <td />
                      <td />
                      {OI_COLUMNS.map((c) => (
                        <td key={c} className="anh-num">
                          {fmt(total([b], c))}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                ))}
                <tr className="subtotal bu-total">
                  <td>
                    Total {group[0].buCode} {group[0].buName}
                  </td>
                  <td>{group[0].buCode}</td>
                  <td />
                  <td />
                  {OI_COLUMNS.map((c) => (
                    <td key={c} className="anh-num">
                      {fmt(total(group, c))}
                    </td>
                  ))}
                </tr>
              </Fragment>
            ))}
            {view.length > 0 && (
              <>
                <tr className="section">
                  <td colSpan={cols}>By account · {view.length === blocks.length ? 'all' : 'filtered'}</td>
                </tr>
                {OI_ACCOUNTS.filter((a) => OI_COLUMNS.some((c) => total(view, c, a.code) !== null)).map((a) => (
                  <tr key={a.code} className="child">
                    <td>{a.name}</td>
                    <td>{bu.length === 1 ? bu[0].split(' ')[0] : 'All'}</td>
                    <td>
                      <span className="anh-code">{a.code}</span>
                    </td>
                    <td>{a.side === 'LL' ? 'Landlord' : (a.side ?? '')}</td>
                    {OI_COLUMNS.map((c) => (
                      <td key={c} className="anh-num calc">
                        {fmt(total(view, c, a.code))}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="total">
                  <td>Total other income</td>
                  <td />
                  <td />
                  <td />
                  {OI_COLUMNS.map((c) => (
                    <td key={c} className="anh-num">
                      {fmt(total(view, c))}
                    </td>
                  ))}
                </tr>
              </>
            )}
            {view.length === 0 && (
              <tr>
                <td colSpan={cols} className="is-empty">
                  {allAccounts ? 'No properties' : 'No other income yet. Tick All accounts to enter it.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
