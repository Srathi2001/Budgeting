'use client';

// Admin overheads (G&A), Finance only: payroll by department (totals from HR), admin overheads by
// department × GL account and the company that pays them, the AMA fee base, and what reaches the P&L
// under the 2026 rules. GL actuals by cost centre are reference only; nothing is pre-filled.

import { Fragment, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { fmt, MONTHS } from '@/lib/format';
import {
  ADMIN_ACCOUNT,
  ADMIN_ACCOUNTS,
  AMA_ENTITIES,
  DEPT,
  DEPTS,
  PAYERS,
  deptName,
  payrollSplit,
  ruleOf,
  type AdminChange,
  type AdminData,
  type AdminRow,
  type PayrollRow,
} from '@/lib/budget/admin-types';
import { ITEM_KIND, SCHEDULE_ACCOUNT } from '@/lib/budget/admin-items';
import { saveAdminCells } from './actions';

type Kind = 'amount' | 'int' | 'pct';

function parse(s: string, kind: Kind): number | null | 'bad' {
  const t = s.replace(/[,\s%]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return 'bad';
  if (kind === 'int') return Number.isInteger(n) && n >= 0 ? n : 'bad';
  if (kind === 'pct') return n >= 0 && n <= 100 ? Math.round(n * 100) / 10000 : 'bad';
  return Math.round(n * 100) / 100;
}
const show = (v: number | null, kind: Kind) => (v === null ? '' : kind === 'pct' ? `${Math.round(v * 10000) / 100}%` : kind === 'int' ? String(v) : fmt(v));
const sum = (a: (number | null)[]) => (a.some((v) => v !== null) ? a.reduce<number>((s, v) => s + (v ?? 0), 0) : null);
const pct = (b: number | null, f: number | null) => (b === null || !f ? '' : `${(((b - f) / Math.abs(f)) * 100).toFixed(1)}%`);

/** A typed cell: shows the value, commits on blur / Enter, Escape cancels. */
function Cell({ value, kind, placeholder, label, disabled, onCommit }: { value: number | null; kind: Kind; placeholder?: string; label: string; disabled: boolean; onCommit: (v: number | null) => Promise<boolean> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<'' | 'dirty' | 'error'>('');
  if (disabled) return <td className="anh-num locked">{show(value, kind)}</td>;
  return (
    <td className={`anh-num input${state === 'dirty' ? ' is-dirty' : state === 'error' ? ' is-error' : ''}`}>
      <input
        aria-label={label}
        inputMode="decimal"
        placeholder={placeholder}
        value={draft ?? show(value, kind)}
        onFocus={(e) => {
          setDraft(value === null ? '' : kind === 'pct' ? String(Math.round(value * 10000) / 100) : String(value));
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          if (draft === null) return;
          const v = parse(draft, kind);
          if (v === 'bad') {
            setState('error');
            return;
          }
          setDraft(null);
          if (v === value) {
            setState('');
            return;
          }
          setState('dirty');
          setState((await onCommit(v)) ? '' : 'error');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </td>
  );
}

export function AdminOverheads({ data: initial, versionId, versionName, locked }: { data: AdminData; versionId: number; versionName: string; locked: boolean }) {
  const [data, setData] = useState(initial);
  const [added, setAdded] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ kind: 'idle' });
  const [, start] = useTransition();
  const Y = data.year;
  const L = { a2: `${Y - 3}A`, a1: `${Y - 2}A`, ytd: data.cutoff ? `${Y - 1} Jan–${MONTHS[data.cutoff - 1]}` : `${Y - 1} YTD`, f: `${Y - 1}F`, b: `${Y}B` };

  const save = (change: AdminChange, apply: (d: AdminData) => AdminData) =>
    new Promise<boolean>((resolve) => {
      const before = data;
      setData(apply);
      setStatus({ kind: 'saving' });
      start(async () => {
        const res = await saveAdminCells(versionId, [change]);
        if (res.errors.length) {
          setData(before);
          setStatus({ kind: 'error', text: res.errors[0] });
          resolve(false);
        } else {
          setStatus({ kind: 'saved', text: 'Saved' });
          resolve(true);
        }
      });
    });

  const setPayroll = (dept: string, field: keyof PayrollRow & ('headcount' | 'ctc' | 'newHeadcount' | 'newCtc' | 'capPct' | 'mjnhPct' | 'asrePct'), value: number | null) =>
    save({ kind: 'payroll', dept, field, value }, (d) => ({ ...d, payroll: d.payroll.map((p) => (p.dept === dept ? { ...p, [field]: value } : p)) }));

  const setAdmin = (dept: string, account: string, entity: string, value: number | null) =>
    save({ kind: 'admin', dept, account, entity, value }, (d) => {
      const exists = d.admin.some((r) => r.dept === dept && r.account === account);
      const rows: AdminRow[] = exists
        ? d.admin.map((r) => (r.dept === dept && r.account === account ? { ...r, b: { ...r.b, [entity]: value } } : r))
        : [...d.admin, { dept, account, a2: null, a1: null, ytd: null, f: null, b: { ...Object.fromEntries(PAYERS.map((p) => [p.code, null])), [entity]: value }, items: Object.fromEntries(PAYERS.map((p) => [p.code, null])), schedule: SCHEDULE_ACCOUNT.get(account) ?? null }];
      return { ...d, admin: rows };
    });

  const setAsset = (entity: string, value: number | null) => save({ kind: 'asset', entity, value }, (d) => ({ ...d, assets: d.assets.map((a) => (a.entity === entity ? { ...a, assetValue: value } : a)) }));

  // ---- payroll ------------------------------------------------------------------------------------------
  const splits = data.payroll.map((p) => ({ p, s: payrollSplit(p) }));
  const pay = {
    total: sum(splits.map(({ p, s }) => (p.ctc === null && p.newCtc === null ? null : s.total))),
    cap: sum(splits.map(({ s }) => s.cap)),
    mjnh: sum(splits.map(({ s }) => s.mjnh)),
    asre: sum(splits.map(({ s }) => s.asre)),
    net: sum(splits.map(({ s }) => s.net)),
  };

  // ---- admin overheads by department ---------------------------------------------------------------------
  const byDept = useMemo(() => {
    const m = new Map<string, AdminRow[]>();
    for (const r of data.admin) m.set(r.dept, [...(m.get(r.dept) ?? []), r]);
    for (const [dept, accts] of Object.entries(added))
      for (const account of accts)
        if (!(m.get(dept) ?? []).some((r) => r.account === account))
          m.set(dept, [...(m.get(dept) ?? []), { dept, account, a2: null, a1: null, ytd: null, f: null, b: Object.fromEntries(PAYERS.map((p) => [p.code, null])), items: Object.fromEntries(PAYERS.map((p) => [p.code, null])), schedule: SCHEDULE_ACCOUNT.get(account) ?? null }]);
    const order = (code: string) => {
      const i = DEPTS.findIndex((d) => d.code === code);
      return i < 0 ? 99 : i;
    };
    return [...new Set([...DEPTS.map((d) => d.code), ...m.keys()])]
      .sort((a, b) => order(a) - order(b))
      .map((dept) => ({ dept, rows: (m.get(dept) ?? []).sort((x, y) => ADMIN_ACCOUNTS.findIndex((a) => a.code === x.account) - ADMIN_ACCOUNTS.findIndex((a) => a.code === y.account)) }));
  }, [data.admin, added]);
  const ohTotal = (rows: AdminRow[], k: 'a2' | 'a1' | 'ytd' | 'f') => sum(rows.map((r) => r[k]));
  // a schedule replaces the typed amount of its department × account × payer
  const cellOf = (r: AdminRow, payer: string) => r.items[payer] ?? r.b[payer];
  const rowBudget = (r: AdminRow) => sum(PAYERS.map((p) => cellOf(r, p.code)));
  const ohBudget = (rows: AdminRow[], payer?: string) => sum(rows.flatMap((r) => (payer ? [cellOf(r, payer)] : PAYERS.map((p) => cellOf(r, p.code)))));
  const allRows = byDept.flatMap((d) => d.rows);
  const enterable = (dept: string) => !locked && !DEPT.get(dept)?.elsewhere;

  // ---- fees ------------------------------------------------------------------------------------------------
  const pma = data.pmaBase * data.pmaRate;
  const ama = data.assets.map((a) => ({ ...a, fee: a.assetValue === null ? null : a.assetValue * data.amaRate }));
  const amaTotal = sum(ama.map((a) => a.fee));
  const ohByPayer = PAYERS.map((p) => ({ ...p, amount: ohBudget(allRows, p.code) }));
  const ga = sum([pay.net, ...ohByPayer.map((p) => p.amount), amaTotal]);

  const head4 = (
    <>
      <th className="anh-num">{L.a2}</th>
      <th className="anh-num">{L.a1}</th>
      <th className="anh-num">{L.ytd}</th>
      <th className="anh-num" title={`${L.ytd} ÷ ${data.cutoff || 12} months × 12`}>
        <span className="fx">fx</span>
        {L.f}
      </th>
    </>
  );
  const four = (r: { a2: number | null; a1: number | null; ytd: number | null; f: number | null }) => (
    <>
      <td className="anh-num locked">{fmt(r.a2)}</td>
      <td className="anh-num locked">{fmt(r.a1)}</td>
      <td className="anh-num locked">{fmt(r.ytd)}</td>
      <td className="anh-num calc">{fmt(r.f)}</td>
    </>
  );

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end gap-4">
        <div>
          <p className="page-sub">
            {versionName} · general &amp; administration by department (Oracle cost centre), as the 2026 budget · Finance only · actuals from the GL (Account Analysis Report)
          </p>
        </div>
        <span className="ml-auto text-xs text-slate-500">
          {status.kind === 'saving' ? 'Saving…' : status.kind === 'error' ? <span className="text-red-600">{status.text}</span> : status.text}
        </span>
      </header>

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

      {/* ---- payroll ---- */}
      <section className="space-y-2">
        <h2 className="text-[15px] font-bold">Payroll by department</h2>
        <p className="text-xs text-slate-500">
          Totals from HR: headcount and annual cost to company (salary, allowances, bonus, gratuity, leave, air fare, medical), current staff and new hires. 2026 rules:
          PDD capitalised to projects with 10% of Finance, 5% of HR, 10% of PM and 5% of General; 21% of HR recharged to MJNH, 5% of Senior Management to ASRE; the rest
          is ANPM&apos;s G&amp;A.
        </p>
        <div className="anh-grid-wrap">
          <table className="anh-grid">
            <thead>
              <tr className="h2">
                <th />
                <th colSpan={3} style={{ textAlign: 'center' }}>
                  Actual payroll
                </th>
                <th className="anh-num">Forecast</th>
                <th colSpan={5} style={{ textAlign: 'center' }}>
                  Budget {L.b}
                </th>
                <th colSpan={3} style={{ textAlign: 'center' }}>
                  Rules
                </th>
                <th className="anh-num" />
              </tr>
              <tr className="h1">
                <th>Department</th>
                {head4}
                <th className="anh-num">Headcount</th>
                <th className="anh-num">Cost to company</th>
                <th className="anh-num">New hires</th>
                <th className="anh-num">New hires cost</th>
                <th className="anh-num">Total</th>
                <th className="anh-num">Capitalised</th>
                <th className="anh-num">To MJNH</th>
                <th className="anh-num">To ASRE</th>
                <th className="anh-num">ANPM G&amp;A</th>
              </tr>
            </thead>
            <tbody>
              {splits.map(({ p, s }) => {
                const rule = ruleOf(p.dept);
                const has = p.ctc !== null || p.newCtc !== null;
                const lbl = (x: string) => `${deptName(p.dept)} ${x}`;
                return (
                  <tr key={p.dept} className="child">
                    <td>
                      <span className="anh-code mr-2">{p.dept}</span>
                      {deptName(p.dept)}
                    </td>
                    {four(p)}
                    <Cell value={p.headcount} kind="int" label={lbl('headcount')} disabled={locked} onCommit={(v) => setPayroll(p.dept, 'headcount', v)} />
                    <Cell value={p.ctc} kind="amount" label={lbl('cost to company')} disabled={locked} onCommit={(v) => setPayroll(p.dept, 'ctc', v)} />
                    <Cell value={p.newHeadcount} kind="int" label={lbl('new hires')} disabled={locked} onCommit={(v) => setPayroll(p.dept, 'newHeadcount', v)} />
                    <Cell value={p.newCtc} kind="amount" label={lbl('new hires cost')} disabled={locked} onCommit={(v) => setPayroll(p.dept, 'newCtc', v)} />
                    <td className="anh-num calc">{has ? fmt(s.total) : ''}</td>
                    <Cell value={p.capPct} kind="pct" placeholder={show(rule.cap, 'pct')} label={lbl('% capitalised')} disabled={locked} onCommit={(v) => setPayroll(p.dept, 'capPct', v)} />
                    <Cell value={p.mjnhPct} kind="pct" placeholder={show(rule.mjnh, 'pct')} label={lbl('% to MJNH')} disabled={locked} onCommit={(v) => setPayroll(p.dept, 'mjnhPct', v)} />
                    <Cell value={p.asrePct} kind="pct" placeholder={show(rule.asre, 'pct')} label={lbl('% to ASRE')} disabled={locked} onCommit={(v) => setPayroll(p.dept, 'asrePct', v)} />
                    <td className="anh-num calc">{has ? fmt(s.net) : ''}</td>
                  </tr>
                );
              })}
              <tr className="subtotal">
                <td>Total payroll budgeted here</td>
                <td className="anh-num">{fmt(sum(data.payroll.map((p) => p.a2)))}</td>
                <td className="anh-num">{fmt(sum(data.payroll.map((p) => p.a1)))}</td>
                <td className="anh-num">{fmt(sum(data.payroll.map((p) => p.ytd)))}</td>
                <td className="anh-num">{fmt(sum(data.payroll.map((p) => p.f)))}</td>
                <td className="anh-num">{fmt(sum(data.payroll.map((p) => p.headcount)))}</td>
                <td className="anh-num">{fmt(sum(data.payroll.map((p) => p.ctc)))}</td>
                <td className="anh-num">{fmt(sum(data.payroll.map((p) => p.newHeadcount)))}</td>
                <td className="anh-num">{fmt(sum(data.payroll.map((p) => p.newCtc)))}</td>
                <td className="anh-num">{fmt(pay.total)}</td>
                <td className="anh-num">{fmt(pay.cap === null ? null : -pay.cap)}</td>
                <td className="anh-num">{fmt(pay.mjnh === null ? null : -pay.mjnh)}</td>
                <td className="anh-num">{fmt(pay.asre === null ? null : -pay.asre)}</td>
                <td className="anh-num">{fmt(pay.net)}</td>
              </tr>
              {data.elsewhere.map((e) => (
                <tr key={e.dept} className="child">
                  <td>
                    <span className="anh-code mr-2">{e.dept}</span>
                    {deptName(e.dept)} <span className="text-xs text-slate-500">· in {DEPT.get(e.dept)?.elsewhere}</span>
                  </td>
                  <td colSpan={8} />
                  <td className="anh-num locked">{fmt(e.budget)}</td>
                  <td colSpan={4} />
                </tr>
              ))}
              <tr className="child">
                <td>Salary allocated to buildings (63112: FM staff, watchmen)</td>
                {four(data.allocation)}
                <td colSpan={9} />
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- admin overheads ---- */}
      <section className="space-y-2">
        <h2 className="text-[15px] font-bold">Admin overheads by department</h2>
        <p className="text-xs text-slate-500">
          The department G&amp;A templates: one amount a year per GL account, spread evenly over the months, by the company that pays it (ANPM, REHL or REHL-MJN).
          Vehicles, telephones, training and staff welfare come only from their tabs above (locked here). FM
          and Security are shown for reference: their overheads are in the FM budget and Building Overheads.
        </p>
        <div className="anh-grid-wrap max-h-[70vh]">
          <table className="anh-grid">
            <thead>
              <tr className="h2">
                <th colSpan={2} />
                <th colSpan={3} style={{ textAlign: 'center' }}>
                  Actual
                </th>
                <th className="anh-num">Forecast</th>
                <th colSpan={PAYERS.length} style={{ textAlign: 'center' }}>
                  Budget {L.b} · paid by
                </th>
                <th className="anh-num" />
              </tr>
              <tr className="h1">
                <th>Account</th>
                <th>GL</th>
                {head4}
                {PAYERS.map((p) => (
                  <th key={p.code} className="anh-num">
                    {p.name}
                  </th>
                ))}
                <th className="anh-num">vs {L.f}</th>
              </tr>
            </thead>
            <tbody>
              {byDept.map(({ dept, rows }) => {
                const d = DEPT.get(dept);
                if (!rows.length && (d?.elsewhere || locked)) return null;
                const shown = new Set(rows.map((r) => r.account));
                return (
                  <Fragment key={dept}>
                    <tr className="section">
                      <td colSpan={2 + 4 + PAYERS.length + 1}>
                        {dept} · {deptName(dept)}
                        {d?.elsewhere && <span className="ml-2 font-normal text-slate-500">in {d.elsewhere}</span>}
                      </td>
                    </tr>
                    {rows.map((r) => {
                      const a = ADMIN_ACCOUNT.get(r.account);
                      return (
                        <tr key={r.account} className="child">
                          <td title={a?.group}>
                            {a?.name ?? r.account}
                            {r.schedule && (
                              <Link href={`/admin-overheads?tab=${r.schedule}`} className="ml-2 text-[11px] underline">
                                {ITEM_KIND.get(r.schedule)!.label} tab
                              </Link>
                            )}
                          </td>
                          <td>
                            <span className="anh-code">{r.account}</span>
                          </td>
                          {four(r)}
                          {PAYERS.map((p) =>
                            r.schedule || r.items[p.code] !== null ? (
                              <td key={p.code} className="anh-num locked" title={r.schedule ? `Entered in the ${ITEM_KIND.get(r.schedule)!.label} tab` : 'From the back-up schedules (tabs above)'}>
                                {fmt(r.items[p.code])}
                              </td>
                            ) : (
                            <Cell
                              key={p.code}
                              value={r.b[p.code]}
                              kind="amount"
                              label={`${deptName(dept)} ${a?.name} paid by ${p.name}`}
                              disabled={!enterable(dept)}
                              onCommit={(v) => setAdmin(dept, r.account, p.code, v)}
                            />
                            ),
                          )}
                          <td className="anh-num calc">{pct(rowBudget(r), r.f)}</td>
                        </tr>
                      );
                    })}
                    {enterable(dept) && (
                      <tr className="child">
                        <td colSpan={2 + 4 + PAYERS.length + 1}>
                          <select
                            aria-label={`Add an account to ${deptName(dept)}`}
                            className="bg-transparent text-xs text-slate-600"
                            value=""
                            onChange={(e) => e.target.value && setAdded((x) => ({ ...x, [dept]: [...(x[dept] ?? []), e.target.value] }))}
                          >
                            <option value="">+ Add account</option>
                            {ADMIN_ACCOUNTS.filter((a) => a.group !== 'Payroll' && !SCHEDULE_ACCOUNT.has(a.code) && !shown.has(a.code)).map((a) => (
                              <option key={a.code} value={a.code}>
                                {a.code} {a.name} · {a.group}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    )}
                    {rows.length > 0 && (
                      <tr className="subtotal">
                        <td>Total {deptName(dept)}</td>
                        <td />
                        <td className="anh-num">{fmt(ohTotal(rows, 'a2'))}</td>
                        <td className="anh-num">{fmt(ohTotal(rows, 'a1'))}</td>
                        <td className="anh-num">{fmt(ohTotal(rows, 'ytd'))}</td>
                        <td className="anh-num">{fmt(ohTotal(rows, 'f'))}</td>
                        {PAYERS.map((p) => (
                          <td key={p.code} className="anh-num">
                            {fmt(ohBudget(rows, p.code))}
                          </td>
                        ))}
                        <td className="anh-num">{pct(ohBudget(rows), ohTotal(rows, 'f'))}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              <tr className="total">
                <td>Total admin overheads</td>
                <td />
                <td className="anh-num">{fmt(ohTotal(allRows, 'a2'))}</td>
                <td className="anh-num">{fmt(ohTotal(allRows, 'a1'))}</td>
                <td className="anh-num">{fmt(ohTotal(allRows, 'ytd'))}</td>
                <td className="anh-num">{fmt(ohTotal(allRows, 'f'))}</td>
                {PAYERS.map((p) => (
                  <td key={p.code} className="anh-num">
                    {fmt(ohBudget(allRows, p.code))}
                  </td>
                ))}
                <td className="anh-num">{pct(ohBudget(allRows), ohTotal(allRows, 'f'))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- fees and what reaches the P&L ---- */}
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-[15px] font-bold">Management fees</h2>
          <p className="text-xs text-slate-500">
            Rates in{' '}
            <Link href="/admin?tab=assumptions" className="underline">
              Admin → Assumptions
            </Link>
            . PMA: ANPM&apos;s income from the landlords, eliminated in the group. AMA: paid to MJNH, outside the group.
          </p>
          <div className="anh-grid-wrap">
            <table className="anh-grid">
              <thead>
                <tr className="h1">
                  <th>Fee</th>
                  <th className="anh-num">Base</th>
                  <th className="anh-num">Rate</th>
                  <th className="anh-num">{L.b}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="child">
                  <td>PMA fee to ANPM · landlords&apos; rent (REHL, REHL-MJN incl. the mall)</td>
                  <td className="anh-num calc">{fmt(data.pmaBase)}</td>
                  <td className="anh-num calc">{show(data.pmaRate, 'pct')}</td>
                  <td className="anh-num calc">{fmt(pma)}</td>
                </tr>
                {ama.map((a) => (
                  <tr key={a.entity} className="child">
                    <td>AMA fee to MJNH · asset value of {AMA_ENTITIES.find((e) => e.key === a.entity)?.name}</td>
                    <Cell value={a.assetValue} kind="amount" label={`Asset value ${a.entity}`} disabled={locked} onCommit={(v) => setAsset(a.entity, v)} />
                    <td className="anh-num calc">{show(data.amaRate, 'pct')}</td>
                    <td className="anh-num calc">{fmt(a.fee)}</td>
                  </tr>
                ))}
                <tr className="subtotal">
                  <td>Total AMA fee</td>
                  <td className="anh-num">{fmt(sum(data.assets.map((a) => a.assetValue)))}</td>
                  <td />
                  <td className="anh-num">{fmt(amaTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-[15px] font-bold">General &amp; administration in the P&amp;L · {L.b}</h2>
          <p className="text-xs text-slate-500">As the Monthly Summary and Consolidated show it, below major repairs.</p>
          <div className="anh-grid-wrap">
            <table className="anh-grid">
              <thead>
                <tr className="h1">
                  <th>Line</th>
                  <th>Company</th>
                  <th className="anh-num">{L.b}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="child">
                  <td>Payroll &amp; staff costs</td>
                  <td>ANPM</td>
                  <td className="anh-num calc">{fmt(pay.total)}</td>
                </tr>
                <tr className="child">
                  <td>Payroll capitalised to projects (PDD)</td>
                  <td>ANPM</td>
                  <td className="anh-num calc">{fmt(pay.cap === null ? null : -pay.cap)}</td>
                </tr>
                <tr className="child">
                  <td>Payroll recharged to MJNH / ASRE</td>
                  <td>ANPM</td>
                  <td className="anh-num calc">{fmt(pay.mjnh === null && pay.asre === null ? null : -((pay.mjnh ?? 0) + (pay.asre ?? 0)))}</td>
                </tr>
                {ohByPayer.map((p) => (
                  <tr key={p.code} className="child">
                    <td>Admin overheads</td>
                    <td>{p.name}</td>
                    <td className="anh-num calc">{fmt(p.amount)}</td>
                  </tr>
                ))}
                <tr className="child">
                  <td>AMA fee to MJNH</td>
                  <td>REHL, REHL-MJN, Mall</td>
                  <td className="anh-num calc">{fmt(amaTotal)}</td>
                </tr>
                <tr className="total">
                  <td>Total general &amp; administration</td>
                  <td />
                  <td className="anh-num">{fmt(ga)}</td>
                </tr>
                <tr className="child">
                  <td>PMA fee income (ANPM, eliminated in the group)</td>
                  <td>ANPM</td>
                  <td className="anh-num calc">{fmt(pma)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
