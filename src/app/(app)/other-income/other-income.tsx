'use client';

// Other income by property × GL account. Actuals come from the GL (locked), the Oct–Dec forecast and
// the budget are typed by the property manager (General rows: Finance), the maintenance service fee
// budget comes from the Lease Budget.

import { Fragment, useMemo, useState, useTransition } from 'react';
import { fmt } from '@/lib/format';
import { useFilters } from '@/components/filter-bar';
import { propertyPasses } from '@/lib/filters';
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
import { GROUP_NAME, classifyOtherIncome, type GroupClass } from '@/lib/budget/group';
import { saveOtherIncomeCells } from './actions';

/** what is taken out of the total to reach the group's other income */
const ADJUSTMENTS: { cls: GroupClass; label: string }[] = [
  { cls: 'outside', label: 'Outside the group · MJNH, MJN Private Office' },
  { cls: 'owners', label: "Owners' share · PMC properties" },
  { cls: 'intergroup', label: 'Intergroup eliminated · PMA fee' },
];

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
  // the shared page filters (BU, PM, category, property)
  const { filters, universe } = useFilters();
  const [allAccounts, setAllAccounts] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [bad, setBad] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ kind: 'idle' });
  const [, start] = useTransition();

  const propInfo = useMemo(() => new Map(universe.map((p) => [p.id, p])), [universe]);
  /** property rows follow every filter; a BU's General (company-level) row only the business unit one */
  const blockPasses = (b: OiBlock) => {
    if (b.kind === 'G') return (filters.bu.length === 0 || filters.bu.includes(b.buCode)) && !filters.pm.length && !filters.cat.length && !filters.prop.length;
    const p = propInfo.get(b.propertyId!);
    return !!p && propertyPasses(p, filters);
  };

  /** accounts shown in a block */
  const accountsOf = (b: OiBlock) =>
    OI_ACCOUNTS.filter((a) => {
      const hasData = OI_COLUMNS.some((c) => oiCell(b, a.code, c) !== null) || OI_COLUMNS.some((c) => dirty.has(key(b.scope, a.code, c)));
      if (hasData) return true;
      return allAccounts && (b.kind === 'G' ? !!a.general : !a.general);
    });

  const view = useMemo(
    () => blocks.filter((b) => blockPasses(b) && accountsOf(b).length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blocks, filters, propInfo, allAccounts, dirty],
  );

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
  /** the rows shown, one column, for the amounts in a group class */
  const classTotal = (c: OiColumn, cls: GroupClass) => {
    let s = 0;
    let any = false;
    for (const b of view)
      for (const a of OI_ACCOUNTS) {
        if (classifyOtherIncome(b.scope, b.buCode, a.code) !== cls) continue;
        const v = oiCell(b, a.code, c);
        if (v !== null) {
          s += v;
          any = true;
        }
      }
    return any ? s : null;
  };
  const adjustments = ADJUSTMENTS.filter((adj) => OI_COLUMNS.some((c) => Math.abs(classTotal(c, adj.cls) ?? 0) >= 0.5));

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
      <td key={c} className={`anh-num ${calc ? 'calc' : 'locked'}`}>
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
      <header className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="page-title">Other Income</h1>
          <p className="page-sub">{versionName} · by property and GL account</p>
        </div>
        <a className="btn ml-auto" href="/api/export/other-income" title="Saved values for the current filters (save typed changes first)">
          Export to Excel
        </a>
      </header>

      <div className="card flex flex-wrap items-center gap-3 px-3 py-2 text-[13px]">
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
            To enter
          </span>
          <span>
            <i className="locked" />
            Locked (actual, calculated, read only)
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
                    <td>{filters.bu.length === 1 ? filters.bu[0] : 'All'}</td>
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
                {adjustments.length > 0 && (
                  <>
                    {adjustments.map((adj) => (
                      <tr key={adj.cls} className="child">
                        <td>{adj.label}</td>
                        <td />
                        <td />
                        <td />
                        {OI_COLUMNS.map((c) => (
                          <td key={c} className="anh-num calc">
                            {fmt(-(classTotal(c, adj.cls) ?? 0))}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="total">
                      <td>Group other income · {GROUP_NAME}</td>
                      <td />
                      <td />
                      <td />
                      {OI_COLUMNS.map((c) => (
                        <td key={c} className="anh-num">
                          {fmt(classTotal(c, 'group'))}
                        </td>
                      ))}
                    </tr>
                  </>
                )}
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
