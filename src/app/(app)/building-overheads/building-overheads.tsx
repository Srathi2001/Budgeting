'use client';

// Building overheads by building × GL account. Actuals come from the GL (locked); the budget is typed by
// the property manager (PM accounts) or Finance (Finance accounts); lump-sum lines also take the month
// they are paid. Nothing is pre-filled: last year's actuals and run-rate stand next to the input.

import { Fragment, useMemo, useState, useTransition } from 'react';
import { fmt, MONTHS } from '@/lib/format';
import { useFilters } from '@/components/filter-bar';
import { propertyPasses } from '@/lib/filters';
import { BOH_ACCOUNT, BOH_ACCOUNTS, BOH_LINES, BOH_LINE_LABEL, paidInOneMonth, type BohBlock, type BohChange, type BohRow } from '@/lib/budget/boh-types';
import { saveBuildingOverheadCells } from './actions';
import { TemplateButtons } from '@/components/template-buttons';

const key = (propertyId: number, account: string) => `${propertyId}|${account}`;
const omit = (d: Record<string, string>, k: string) => Object.fromEntries(Object.entries(d).filter(([x]) => x !== k));

function parseAmount(s: string): number | null | 'bad' {
  const t = s.replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 'bad';
}

type Col = 'a2' | 'a1' | 'ytd' | 'f' | 'b';
const COLS: Col[] = ['a2', 'a1', 'ytd', 'f', 'b'];
const hasData = (r: BohRow) => COLS.some((c) => r[c] !== null && Math.abs(r[c]!) >= 0.5);
const pct = (b: number | null, f: number | null) => (b === null || !f ? null : (b - f) / Math.abs(f));

export function BuildingOverheads({
  blocks: initial,
  versionId,
  versionName,
  year,
  cutoff,
  locked,
  finance,
}: {
  blocks: BohBlock[];
  versionId: number;
  versionName: string;
  year: number;
  /** last month of Y-1 in the GL actuals (0 = none) */
  cutoff: number;
  locked: boolean;
  finance: boolean;
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

  const label: Record<Col, string> = {
    a2: `${year - 3}A`,
    a1: `${year - 2}A`,
    ytd: cutoff ? `${year - 1} Jan–${MONTHS[cutoff - 1]}` : `${year - 1} YTD`,
    f: `${year - 1}F`,
    b: `${year}B`,
  };

  const propInfo = useMemo(() => new Map(universe.map((p) => [p.id, p])), [universe]);
  const canEnter = (b: BohBlock, account: string) => !locked && b.editable && (finance || BOH_ACCOUNT.get(account)?.owner === 'PM');
  /** accounts shown for a building: with figures or typed, or every account the user can enter (All accounts) */
  const rowsOf = (b: BohBlock) => b.rows.filter((r) => hasData(r) || dirty.has(key(b.propertyId, r.account)) || (allAccounts && canEnter(b, r.account)));

  const view = useMemo(
    () => blocks.filter((b) => {
      const p = propInfo.get(b.propertyId);
      return !!p && propertyPasses(p, filters) && rowsOf(b).length > 0;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blocks, filters, propInfo, allAccounts, dirty],
  );

  const total = (bs: BohBlock[], c: Col, match: (account: string) => boolean = () => true) => {
    let s = 0;
    let any = false;
    for (const b of bs)
      for (const r of b.rows) {
        if (!match(r.account) || r[c] === null) continue;
        s += r[c]!;
        any = true;
      }
    return any ? s : null;
  };

  const save = (b: BohBlock, account: string, change: BohChange, restore: BohRow) => {
    const k = key(b.propertyId, account);
    setDirty((s) => new Set(s).add(k));
    setStatus({ kind: 'saving' });
    start(async () => {
      const res = await saveBuildingOverheadCells(versionId, [change]);
      setDirty((s) => {
        const n = new Set(s);
        n.delete(k);
        return n;
      });
      if (res.errors.length) {
        // put the stored values back
        setBlocks((all) => all.map((x) => (x.propertyId === b.propertyId ? { ...x, rows: x.rows.map((r) => (r.account === account ? restore : r)) } : x)));
        setStatus({ kind: 'error', text: res.errors[0] });
      } else setStatus({ kind: 'saved', text: 'Saved' });
    });
  };

  const update = (b: BohBlock, account: string, patch: Partial<BohRow>) =>
    setBlocks((all) => all.map((x) => (x.propertyId === b.propertyId ? { ...x, rows: x.rows.map((r) => (r.account === account ? { ...r, ...patch } : r)) } : x)));

  const commitAmount = (b: BohBlock, r: BohRow) => {
    const k = key(b.propertyId, r.account);
    if (!(k in drafts)) return;
    const parsed = parseAmount(drafts[k]);
    if (parsed === 'bad') {
      setBad((s) => new Set(s).add(k));
      setStatus({ kind: 'error', text: `${b.code} ${BOH_ACCOUNT.get(r.account)?.name}: not a number` });
      return;
    }
    setBad((s) => {
      const n = new Set(s);
      n.delete(k);
      return n;
    });
    setDrafts((d) => omit(d, k));
    if (parsed === r.b) return;
    update(b, r.account, { b: parsed, dueMonth: parsed === null ? null : r.dueMonth });
    save(b, r.account, { propertyId: b.propertyId, account: r.account, amount: parsed, dueMonth: parsed === null ? null : r.dueMonth }, r);
  };

  const commitDue = (b: BohBlock, r: BohRow, month: number | null) => {
    if (month === r.dueMonth || r.b === null) return;
    update(b, r.account, { dueMonth: month });
    save(b, r.account, { propertyId: b.propertyId, account: r.account, amount: r.b, dueMonth: month }, r);
  };

  const amountCell = (b: BohBlock, r: BohRow) => {
    const k = key(b.propertyId, r.account);
    if (!canEnter(b, r.account))
      return (
        <td className="anh-num locked" title={BOH_ACCOUNT.get(r.account)?.owner === 'FIN' && !finance ? 'Entered by Finance' : undefined}>
          {fmt(r.b)}
        </td>
      );
    return (
      <td className={`anh-num input${dirty.has(k) ? ' is-dirty' : ''}${bad.has(k) ? ' is-error' : ''}`}>
        <input
          aria-label={`${b.code} ${BOH_ACCOUNT.get(r.account)?.name} ${label.b}`}
          inputMode="decimal"
          value={k in drafts ? drafts[k] : r.b === null ? '' : fmt(r.b)}
          onFocus={(e) => {
            setDrafts((d) => ({ ...d, [k]: r.b === null ? '' : String(r.b) }));
            requestAnimationFrame(() => e.target.select());
          }}
          onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))}
          onBlur={() => commitAmount(b, r)}
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
  };

  const dueCell = (b: BohBlock, r: BohRow) => {
    const acct = BOH_ACCOUNT.get(r.account)!;
    if (!paidInOneMonth(acct)) return <td className="locked" title={acct.phasing === 'seasonal' ? "The portfolio's monthly pattern of the last two full years (summer peak)" : 'Evenly over 12 months'}>{acct.phasing === 'seasonal' ? 'Seasonal' : 'Monthly'}</td>;
    const shown = r.dueMonth ?? r.defaultDue;
    // premiums paid upfront: expensed monthly, paid (cash flow) in one month
    const prefix = acct.paidUpfront ? 'Monthly · paid ' : '';
    if (!canEnter(b, r.account) || r.b === null)
      return (
        <td className="locked" title={acct.paidUpfront ? 'Expensed evenly over 12 months; paid in this month (cash flow)' : undefined}>
          {prefix}
          {MONTHS[shown - 1]}
        </td>
      );
    return (
      <td className="input">
        <select
          aria-label={`${b.code} ${acct.name} month paid`}
          className="w-full bg-transparent"
          value={r.dueMonth ?? ''}
          onChange={(e) => commitDue(b, r, e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">
            {prefix}
            {MONTHS[r.defaultDue - 1]} (as last year)
          </option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {prefix}
              {m}
            </option>
          ))}
        </select>
      </td>
    );
  };

  const byBu = useMemo(() => {
    const m = new Map<string, BohBlock[]>();
    for (const b of view) m.set(b.buCode, [...(m.get(b.buCode) ?? []), b]);
    return [...m.values()];
  }, [view]);

  const nums = (bs: BohBlock[], match?: (account: string) => boolean) => {
    const f = total(bs, 'f', match);
    const b = total(bs, 'b', match);
    return (
      <>
        {COLS.map((c) => (
          <td key={c} className="anh-num">
            {fmt(total(bs, c, match))}
          </td>
        ))}
        <td />
        <td className="anh-num">{pct(b, f) === null ? '' : `${(pct(b, f)! * 100).toFixed(1)}%`}</td>
      </>
    );
  };

  const cols = 4 + COLS.length + 2;
  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="page-title">Building Overheads</h1>
          <p className="page-sub">
            {versionName} · by building and GL account · actuals from the GL (Account Analysis Report) · property managers enter contracts and running costs, Finance
            enters utilities, insurance, watchmen, civil defence, consultancy and service charges
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <TemplateButtons kind="building-overheads" versionId={versionId} canImport={!locked} />
        </div>
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
              <th className="anh-num">Forecast</th>
              <th colSpan={3} style={{ textAlign: 'center' }}>
                Budget
              </th>
            </tr>
            <tr className="h1">
              <th>Account</th>
              <th>GL</th>
              <th>P&amp;L line</th>
              <th>By</th>
              {COLS.map((c) => (
                <th key={c} className="anh-num" title={c === 'f' ? `Contracts: ${label.ytd} ÷ ${cutoff || 12} months × 12 · water & electricity: ${label.ytd} + last year's remaining months · lump sums: this year's payment once made, else last year's` : undefined}>
                  {c === 'f' && <span className="fx">fx</span>}
                  {label[c]}
                </th>
              ))}
              <th title="When the budget is booked: monthly, the portfolio's seasonal pattern, or the month paid; insurance is expensed monthly and paid (cash flow) in the month shown">Phasing</th>
              <th className="anh-num">vs {label.f}</th>
            </tr>
          </thead>
          <tbody>
            {byBu.map((group) => (
              <Fragment key={group[0].buCode}>
                {group.map((b) => {
                  const rows = rowsOf(b);
                  return (
                    <Fragment key={b.propertyId}>
                      <tr className="section">
                        <td colSpan={cols}>
                          {b.code} · {b.name}
                          {b.pm && <span className="ml-2 font-normal text-slate-500">{b.pm}</span>}
                        </td>
                      </tr>
                      {rows.map((r) => {
                        const a = BOH_ACCOUNT.get(r.account)!;
                        const p = pct(r.b, r.f);
                        return (
                          <tr key={r.account} className="child">
                            <td title={a.group}>{a.name}</td>
                            <td>
                              <span className="anh-code">{a.code}</span>
                            </td>
                            <td>{BOH_LINE_LABEL[a.line]}</td>
                            <td>{a.owner === 'PM' ? 'PM' : 'Finance'}</td>
                            <td className="anh-num locked">{fmt(r.a2)}</td>
                            <td className="anh-num locked">{fmt(r.a1)}</td>
                            <td className="anh-num locked">{fmt(r.ytd)}</td>
                            <td className="anh-num calc">{fmt(r.f)}</td>
                            {amountCell(b, r)}
                            {dueCell(b, r)}
                            <td className="anh-num calc">{p === null ? '' : `${(p * 100).toFixed(1)}%`}</td>
                          </tr>
                        );
                      })}
                      <tr className="subtotal">
                        <td>Total {b.code}</td>
                        <td />
                        <td />
                        <td />
                        {nums([b])}
                      </tr>
                    </Fragment>
                  );
                })}
                <tr className="subtotal bu-total">
                  <td>
                    Total {group[0].buCode} {group[0].buName}
                  </td>
                  <td />
                  <td />
                  <td />
                  {nums(group)}
                </tr>
              </Fragment>
            ))}
            {view.length > 0 && (
              <>
                <tr className="section">
                  <td colSpan={cols}>By Building P&amp;L line · {view.length} building{view.length === 1 ? '' : 's'}</td>
                </tr>
                {BOH_LINES.filter((l) => COLS.some((c) => total(view, c, (acc) => BOH_ACCOUNT.get(acc)?.line === l.key) !== null)).map((l) => (
                  <tr key={l.key} className="child">
                    <td>{l.label}</td>
                    <td />
                    <td />
                    <td />
                    {nums(view, (acc) => BOH_ACCOUNT.get(acc)?.line === l.key)}
                  </tr>
                ))}
                <tr className="total">
                  <td>Total building overheads</td>
                  <td />
                  <td />
                  <td />
                  {nums(view)}
                </tr>
              </>
            )}
            {view.length === 0 && (
              <tr>
                <td colSpan={cols} className="is-empty">
                  {allAccounts ? 'No buildings for these filters' : `No building overheads yet. Tick All accounts to enter them (${BOH_ACCOUNTS.length} accounts).`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
