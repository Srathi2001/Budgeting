'use client';

// Building overheads by building × GL account. Actuals come from the GL (locked); the budget is typed by
// the property manager (PM accounts) or Finance (Finance accounts); lump-sum lines also take the month
// they are paid. Nothing is pre-filled: last year's actuals and run-rate stand next to the input.

import { Fragment, useMemo, useState, useTransition } from 'react';
import { fmt, MONTHS, pct as pctOf } from '@/lib/format';
import { useFilters } from '@/components/filter-bar';
import { propertyPasses } from '@/lib/filters';
import { BOH_ACCOUNT, BOH_ACCOUNTS, BOH_CALC_NOTE, BOH_LINES, BOH_LINE_LABEL, paidInOneMonth, type BohBlock, type BohChange, type BohRow } from '@/lib/budget/boh-types';
import { saveBuildingOverheadCells } from './actions';
import { TemplateButtons } from '@/components/template-buttons';
import { ListAndForm } from '@/components/record-form';
import { BohForm, applyBohChange } from './boh-form';

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
const hasData = (r: BohRow) => COLS.some((c) => r[c] !== null && Math.abs(r[c]!) >= 0.5) || Math.abs(r.pb ?? 0) >= 0.5;
const pct = (b: number | null, f: number | null) => (b === null || !f ? null : (b - f) / Math.abs(f));
/** this year's budget less last year's (reference), either may be missing */
const change = (b: number | null, pb: number | null) => (b === null && pb === null ? null : (b ?? 0) - (pb ?? 0));
/** calculated where it comes from (Assumptions, Security allocation, the contract schedule), not typed */
const fixed = (r: BohRow) => r.calc !== null && r.calc !== 'forecast';

export function BuildingOverheads({
  blocks: initial,
  versionId,
  versionName,
  year,
  cutoff,
  locked,
  priorLabel = null,
}: {
  blocks: BohBlock[];
  versionId: number;
  versionName: string;
  year: number;
  /** last month of Y-1 in the GL actuals (0 = none) */
  cutoff: number;
  locked: boolean;
  /** last year's approved budget shown for reference (e.g. 2026B), null: none loaded */
  priorLabel?: string | null;
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
  // the building open in the side form
  const [open, setOpen] = useState<number | null>(null);

  const label: Record<Col, string> = {
    a2: `${year - 3}A`,
    a1: `${year - 2}A`,
    ytd: cutoff ? `${year - 1} Jan–${MONTHS[cutoff - 1]}` : `${year - 1} YTD`,
    f: `${year - 1}F`,
    b: `${year}B`,
  };

  const propInfo = useMemo(() => new Map(universe.map((p) => [p.id, p])), [universe]);
  // each account is entered by its owner: the property manager's by the PM, Finance's by Finance
  const canEnter = (b: BohBlock, account: string) => !locked && (BOH_ACCOUNT.get(account)?.owner === 'FIN' ? b.finEditable : b.editable);
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
    if (parsed === r.entered) return;
    // municipal charges: last year's forecast until an amount is entered
    const byForecast = parsed === null && r.calc === 'forecast';
    update(b, r.account, { entered: parsed, b: parsed ?? (byForecast ? r.f : null), calc: byForecast ? 'forecast' : null, dueMonth: parsed === null ? null : r.dueMonth });
    save(b, r.account, { propertyId: b.propertyId, account: r.account, amount: parsed, dueMonth: parsed === null ? null : r.dueMonth }, r);
  };

  const commitDue = (b: BohBlock, r: BohRow, month: number | null) => {
    if (month === r.dueMonth || r.b === null) return;
    // a month is kept with the typed amount; a line still following last year's forecast has none to
    // keep it on, so the forecast is never turned into a typed figure behind the user's back
    if (r.entered === null) {
      setStatus({ kind: 'error', text: `${b.code} ${BOH_ACCOUNT.get(r.account)?.name}: enter the amount first; while it follows last year's forecast it is paid in the month of last year's largest payment` });
      return;
    }
    update(b, r.account, { dueMonth: month });
    save(b, r.account, { propertyId: b.propertyId, account: r.account, amount: r.entered, dueMonth: month }, r);
  };

  const amountCell = (b: BohBlock, r: BohRow) => {
    const k = key(b.propertyId, r.account);
    if (fixed(r))
      return (
        <td className="anh-num calc" title={r.entered === null ? BOH_CALC_NOTE[r.calc!] : `${BOH_CALC_NOTE[r.calc!]} · a typed amount of ${fmt(r.entered)} is kept but not used while this applies`}>
          {fmt(r.b)}
          {r.entered !== null && (
            <span className="ml-1 text-[9px] font-bold uppercase tracking-wider" aria-label="A typed amount is hidden by the calculation">
              typed
            </span>
          )}
        </td>
      );
    if (!canEnter(b, r.account))
      return (
        <td className="anh-num locked" title={locked ? undefined : BOH_ACCOUNT.get(r.account)?.owner === 'FIN' ? 'Entered by Finance' : 'Entered by the property manager'}>
          {fmt(r.b)}
        </td>
      );
    return (
      <td className={`anh-num input${dirty.has(k) ? ' is-dirty' : ''}${bad.has(k) ? ' is-error' : ''}`}>
        <input
          aria-label={`${b.code} ${BOH_ACCOUNT.get(r.account)?.name} ${label.b}`}
          inputMode="decimal"
          value={k in drafts ? drafts[k] : r.entered === null ? '' : fmt(r.entered)}
          placeholder={r.calc === 'forecast' ? fmt(r.b) : undefined}
          title={r.calc === 'forecast' ? BOH_CALC_NOTE.forecast : undefined}
          onFocus={(e) => {
            setDrafts((d) => ({ ...d, [k]: r.entered === null ? '' : String(r.entered) }));
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
    if (r.calc === 'contracts') return <td className="locked" title="By each contract's terms">Per contracts</td>;
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

  /** last year's budget (reference) of the rows matched, with what it had on accounts the tool does not have */
  const refTotal = (bs: BohBlock[], match?: (account: string) => boolean) => {
    let s = 0;
    let any = false;
    for (const b of bs) {
      for (const r of b.rows)
        if ((!match || match(r.account)) && r.pb != null) {
          s += r.pb;
          any = true;
        }
      for (const o of b.pbOther ?? [])
        if (!match || match(o.account)) {
          s += o.amount;
          any = true;
        }
    }
    return any ? s : null;
  };

  const nums = (bs: BohBlock[], match?: (account: string) => boolean) => {
    const f = total(bs, 'f', match);
    const b = total(bs, 'b', match);
    const pb = ref ? refTotal(bs, match) : null;
    return (
      <>
        {COLS.map((c) => (
          <Fragment key={c}>
            {c === 'b' && ref && <td className="anh-num">{fmt(pb)}</td>}
            <td className="anh-num">{fmt(total(bs, c, match))}</td>
          </Fragment>
        ))}
        <td />
        <td className="anh-num">{pct(b, f) === null ? '' : pctOf(pct(b, f))}</td>
        {ref && <td className="anh-num">{fmt(change(b, pb))}</td>}
      </>
    );
  };

  const ref = !!priorLabel;
  const cols = 4 + COLS.length + 2 + (ref ? 2 : 0);
  const openIdx = view.findIndex((b) => b.propertyId === open);
  const openBlock = openIdx >= 0 ? view[openIdx] : null;
  const form = openBlock && (
    <BohForm
      key={openBlock.propertyId}
      block={openBlock}
      rows={openBlock.rows.filter((r) => hasData(r) || canEnter(openBlock, r.account))}
      year={year}
      locked={locked}
      priorLabel={priorLabel}
      versionId={versionId}
      onSaved={(changes) => {
        for (const c of changes) {
          const r = openBlock.rows.find((x) => x.account === c.account);
          if (r) update(openBlock, c.account, applyBohChange(r, c));
        }
      }}
      onClose={() => setOpen(null)}
      onPrev={openIdx > 0 ? () => setOpen(view[openIdx - 1].propertyId) : undefined}
      onNext={openIdx < view.length - 1 ? () => setOpen(view[openIdx + 1].propertyId) : undefined}
    />
  );
  return (
    <ListAndForm form={form}>
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="page-title">Building Overheads</h1>
          <p className="page-sub">
            {versionName} · by building and GL account · actuals from the GL (Account Analysis Report) · property managers enter running costs and the contract schedules, Finance the other lines; water &
            electricity, insurance, watchmen and contract lines are calculated (see the tabs)
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
          <span>Click a building to open it in the form</span>
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
              <th colSpan={ref ? 3 : 2} style={{ textAlign: 'center' }}>
                Budget
              </th>
              <th colSpan={ref ? 2 : 1} style={{ textAlign: 'center' }}>
                Change
              </th>
            </tr>
            <tr className="h1">
              <th>Account</th>
              <th>GL</th>
              <th>P&amp;L line</th>
              <th>By</th>
              {COLS.map((c) => (
                <Fragment key={c}>
                {c === 'b' && ref && (
                  <th className="anh-num" title="The approved budget of last year, from its workbook: reference only">
                    {priorLabel}
                  </th>
                )}
                <th className="anh-num" title={c === 'f' ? `Contracts: ${label.ytd} ÷ ${cutoff || 12} months × 12 · water & electricity: ${label.ytd} + last year's remaining months · lump sums: this year's payment once made, else last year's` : undefined}>
                  {c === 'f' && <span className="fx">fx</span>}
                  {label[c]}
                </th>
                </Fragment>
              ))}
              <th title="When the budget is booked: monthly, the portfolio's seasonal pattern, or the month paid; insurance is expensed monthly and paid (cash flow) in the month shown">Phasing</th>
              <th className="anh-num">vs {label.f}</th>
              {ref && <th className="anh-num">{label.b} vs {priorLabel}</th>}
            </tr>
          </thead>
          <tbody>
            {byBu.map((group) => (
              <Fragment key={group[0].buCode}>
                {group.map((b) => {
                  const rows = rowsOf(b);
                  return (
                    <Fragment key={b.propertyId}>
                      <tr className={'section cursor-pointer' + (open === b.propertyId ? ' is-selected' : '')} onClick={() => setOpen(b.propertyId)} title="Open in the form">
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
                            {ref && (
                              <td className="anh-num locked" title={r.pbNote ?? undefined}>
                                {fmt(r.pb ?? null)}
                              </td>
                            )}
                            {amountCell(b, r)}
                            {dueCell(b, r)}
                            <td className="anh-num calc">{p === null ? '' : pctOf(p)}</td>
                            {ref && <td className="anh-num calc">{fmt(change(r.b, r.pb ?? null))}</td>}
                          </tr>
                        );
                      })}
                      {ref &&
                        (b.pbOther ?? []).map((o) => (
                          <tr key={`ref-${o.account}`} className="child">
                            <td title={o.note ?? undefined}>{o.note ?? 'In the last budget only'}</td>
                            <td>
                              <span className="anh-code">{o.account}</span>
                            </td>
                            <td />
                            <td />
                            <td colSpan={4} />
                            <td className="anh-num locked">{fmt(o.amount)}</td>
                            <td colSpan={3} />
                            <td className="anh-num calc">{fmt(-o.amount)}</td>
                          </tr>
                        ))}
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
                {BOH_LINES.filter((l) => COLS.some((c) => total(view, c, (acc) => BOH_ACCOUNT.get(acc)?.line === l.key) !== null) || (ref && refTotal(view, (acc) => BOH_ACCOUNT.get(acc)?.line === l.key) !== null)).map((l) => (
                  <tr key={l.key} className="child">
                    <td>{l.label}</td>
                    <td />
                    <td />
                    <td />
                    {nums(view, (acc) => BOH_ACCOUNT.get(acc)?.line === l.key)}
                  </tr>
                ))}
                {ref && refTotal(view, (acc) => !BOH_ACCOUNT.has(acc)) !== null && (
                  <tr className="child">
                    <td>In the last budget only (no account in the tool)</td>
                    <td />
                    <td />
                    <td />
                    {nums(view, (acc) => !BOH_ACCOUNT.has(acc))}
                  </tr>
                )}
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
    </ListAndForm>
  );
}
