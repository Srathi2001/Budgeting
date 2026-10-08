'use client';

// Building overheads' supporting tabs: Assumptions (percentages, cost per watchman, the insurance base
// per building), Security allocation (watchmen per building) and the contract schedules (AMC tabs, one
// component for all six). Each calculated budget shows next to last year's forecast.

import { Fragment, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fmt, MONTHS, sum } from '@/lib/format';
import { useFilters } from '@/components/filter-bar';
import { propertyPasses } from '@/lib/filters';
import { TemplateButtons } from '@/components/template-buttons';
import type { Assumptions } from '@/lib/engine/assumptions';
import { BOH_ACCOUNT, CONTRACT_KIND, CONTRACT_TERMS, type BohBlock, type ContractKind, type ContractRow, type ContractTerms } from '@/lib/budget/boh-types';
import { contractAmount, parBudget, plBudget, watchmenBudget } from '@/lib/budget/boh-calc';
import type { InsuranceRow } from '@/lib/budget/boh-schedules';
import { saveBohAssumptions, saveContracts, saveInsurance, saveWatchmen } from './actions';

interface Common {
  blocks: BohBlock[];
  versionId: number;
  year: number;
  cutoff: number;
  locked: boolean;
  finance: boolean;
}
type Msg = { error?: string; ok?: string } | null;

const parse = (s: string): number | null | 'bad' => {
  const t = s.replace(/[,\s%]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : 'bad';
};
const MsgLine = ({ msg }: { msg: Msg }) => (msg ? <span className={`text-sm ${msg.error ? 'text-red-600' : ''}`}>{msg.error ?? msg.ok}</span> : null);
const row = (b: BohBlock, account: string) => b.rows.find((r) => r.account === account);
const ytdLabel = (year: number, cutoff: number) => (cutoff ? `${year - 1} Jan–${MONTHS[cutoff - 1]}` : `${year - 1} YTD`);

/** the buildings in the page filters */
function useView(blocks: BohBlock[]) {
  const { filters, universe } = useFilters();
  const info = useMemo(() => new Map(universe.map((p) => [p.id, p])), [universe]);
  return useMemo(() => blocks.filter((b) => info.has(b.propertyId) && propertyPasses(info.get(b.propertyId)!, filters)), [blocks, info, filters]);
}

function NumInput({ value, onChange, label, bad, width = 'w-full' }: { value: string; onChange: (v: string) => void; label: string; bad?: boolean; width?: string }) {
  return (
    <td className={`anh-num input${bad ? ' is-error' : ''}`}>
      <input aria-label={label} inputMode="decimal" className={width} value={value} onChange={(e) => onChange(e.target.value)} />
    </td>
  );
}

// ---- Assumptions ------------------------------------------------------------------------------------

export function BohAssumptions({ blocks, versionId, year, cutoff, locked, finance, assumptions, insurance }: Common & { assumptions: Assumptions; insurance: InsuranceRow[] }) {
  const router = useRouter();
  const view = useView(blocks);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const edit = finance && !locked;
  const pctText = (v: number) => String(Math.round(v * 10000) / 100);
  const [a, setA] = useState({
    bohUtilitiesPct: pctText(assumptions.bohUtilitiesPct),
    insParPct: pctText(assumptions.insParPct),
    insPlPct: pctText(assumptions.insPlPct),
    watchmanCost: String(assumptions.watchmanCost),
  });
  const pct = (k: 'bohUtilitiesPct' | 'insParPct' | 'insPlPct') => {
    const v = parse(a[k]);
    return typeof v === 'number' ? v / 100 : assumptions[k];
  };
  const byId = new Map(insurance.map((i) => [i.propertyId, i]));
  const [drafts, setDrafts] = useState<Record<number, { value: string; rate: string; pl: string }>>({});
  const draftOf = (id: number) => {
    const i = byId.get(id);
    return drafts[id] ?? { value: i?.insuredValue ? String(i.insuredValue) : '', rate: i?.parRate ? String(Math.round(i.parRate * 1e10) / 1e8) : '', pl: i?.plPremium ? String(i.plPremium) : '' };
  };
  const vals = (id: number) => {
    const d = draftOf(id);
    const v = parse(d.value);
    const r = parse(d.rate);
    const p = parse(d.pl);
    return { value: typeof v === 'number' ? v : null, rate: typeof r === 'number' ? r / 100 : null, pl: typeof p === 'number' ? p : null, bad: [v, r, p].includes('bad') };
  };

  const saveA = () =>
    start(async () => {
      const n = { bohUtilitiesPct: parse(a.bohUtilitiesPct), insParPct: parse(a.insParPct), insPlPct: parse(a.insPlPct), watchmanCost: parse(a.watchmanCost) };
      if (Object.values(n).some((x) => typeof x !== 'number')) return setMsg({ error: 'Every assumption needs a number' });
      const r = await saveBohAssumptions(versionId, { bohUtilitiesPct: (n.bohUtilitiesPct as number) / 100, insParPct: (n.insParPct as number) / 100, insPlPct: (n.insPlPct as number) / 100, watchmanCost: n.watchmanCost });
      setMsg(r);
      if (!r.error) router.refresh();
    });
  const saveI = () =>
    start(async () => {
      const ids = Object.keys(drafts).map(Number);
      if (ids.some((id) => vals(id).bad)) return setMsg({ error: 'Insurance figures must be numbers' });
      const r = await saveInsurance(
        versionId,
        ids.map((id) => ({ propertyId: id, insuredValue: vals(id).value, parRate: vals(id).rate, plPremium: vals(id).pl })),
      );
      setMsg(r);
      if (!r.error) router.refresh();
    });

  const field = (k: keyof typeof a, label: string, unit: string, note: string) => (
    <tr key={k}>
      <td className="font-bold">{label}</td>
      {edit ? (
        <NumInput value={a[k]} onChange={(v) => setA((x) => ({ ...x, [k]: v }))} label={label} bad={parse(a[k]) === 'bad'} />
      ) : (
        <td className="anh-num locked">{a[k]}</td>
      )}
      <td>{unit}</td>
      <td>{note}</td>
    </tr>
  );
  const totals = view.reduce(
    (t, b) => {
      const v = vals(b.propertyId);
      const par = parBudget(v.value, v.rate, pct('insParPct')) ?? 0;
      const pl = plBudget(v.pl, pct('insPlPct')) ?? 0;
      return { par: t.par + par, pl: t.pl + pl, f: t.f + (row(b, '64601')?.f ?? 0) + (row(b, '64604')?.f ?? 0), last: t.last + (v.value && v.rate ? v.value * v.rate : 0) + (v.pl ?? 0) };
    },
    { par: 0, pl: 0, f: 0, last: 0 },
  );

  return (
    <div className="space-y-5 p-6">
      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold">Assumptions · {year}B</h2>
          {edit && (
            <button className="btn-primary" onClick={saveA} disabled={pending}>
              Save assumptions
            </button>
          )}
          <MsgLine msg={msg} />
        </div>
        <table className="anh-grid">
          <tbody>
            {field('bohUtilitiesPct', 'Water & electricity', '%', `${year - 1}F = ${ytdLabel(year, cutoff)} + last year’s remaining months × (1 + %); ${year}B = ${year - 1}F × (1 + %)`)}
            {field('insParPct', 'Insurance PAR rate change', '%', `${year}B PAR = insured value × last year’s rate × (1 + %)`)}
            {field('insPlPct', 'Public liability premium change', '%', `${year}B public liability = last year’s premium × (1 + %)`)}
            {field('watchmanCost', 'Cost per watchman a year', 'AED', 'Watchmen budget = watchmen per building (Security allocation) × this')}
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold">Insurance by building</h2>
          {edit && (
            <button className="btn-primary" onClick={saveI} disabled={pending || !Object.keys(drafts).length}>
              Save insurance
            </button>
          )}
        </div>
        <table className="anh-grid">
          <thead>
            <tr className="h1">
              <th>Building</th>
              <th className="anh-num">Insured value</th>
              <th className="anh-num">PAR rate {year - 1} (%)</th>
              <th className="anh-num">PAR {year}B</th>
              <th className="anh-num">Liability premium {year - 1}</th>
              <th className="anh-num">Liability {year}B</th>
              <th className="anh-num">Insurance {year}B</th>
              <th className="anh-num">PAR + liability {year - 1}F</th>
            </tr>
          </thead>
          <tbody>
            {view.map((b) => {
              const d = draftOf(b.propertyId);
              const v = vals(b.propertyId);
              const par = parBudget(v.value, v.rate, pct('insParPct'));
              const pl = plBudget(v.pl, pct('insPlPct'));
              const set = (k: keyof typeof d) => (s: string) => setDrafts((x) => ({ ...x, [b.propertyId]: { ...d, [k]: s } }));
              const f = (row(b, '64601')?.f ?? 0) + (row(b, '64604')?.f ?? 0);
              return (
                <tr key={b.propertyId}>
                  <td>
                    {b.code} · {b.name}
                  </td>
                  {edit ? <NumInput value={d.value} onChange={set('value')} label={`${b.code} insured value`} bad={parse(d.value) === 'bad'} /> : <td className="anh-num locked">{fmt(v.value)}</td>}
                  {edit ? <NumInput value={d.rate} onChange={set('rate')} label={`${b.code} PAR rate`} bad={parse(d.rate) === 'bad'} /> : <td className="anh-num locked">{d.rate}</td>}
                  <td className="anh-num calc">{fmt(par)}</td>
                  {edit ? <NumInput value={d.pl} onChange={set('pl')} label={`${b.code} liability premium`} bad={parse(d.pl) === 'bad'} /> : <td className="anh-num locked">{fmt(v.pl)}</td>}
                  <td className="anh-num calc">{fmt(pl)}</td>
                  <td className="anh-num calc">{fmt((par ?? 0) + (pl ?? 0))}</td>
                  <td className="anh-num locked">{fmt(f || null)}</td>
                </tr>
              );
            })}
            <tr className="total">
              <td>Total · {view.length} buildings</td>
              <td />
              <td />
              <td className="anh-num">{fmt(totals.par)}</td>
              <td />
              <td className="anh-num">{fmt(totals.pl)}</td>
              <td className="anh-num">{fmt(totals.par + totals.pl)}</td>
              <td className="anh-num">{fmt(totals.f)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ---- Security allocation --------------------------------------------------------------------------------

export function SecurityAllocation({ blocks, versionId, year, cutoff, locked, finance, cost, shares }: Common & { cost: number; shares: Record<number, number> }) {
  const router = useRouter();
  const view = useView(blocks);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const edit = finance && !locked;
  const shareOf = (id: number) => {
    const v = drafts[id] !== undefined ? parse(drafts[id]) : (shares[id] ?? null);
    return typeof v === 'number' ? v : null;
  };
  const save = () =>
    start(async () => {
      const ids = Object.keys(drafts).map(Number);
      if (ids.some((id) => parse(drafts[id]) === 'bad')) return setMsg({ error: 'Watchmen must be numbers' });
      const r = await saveWatchmen(versionId, ids.map((id) => ({ propertyId: id, share: shareOf(id) })));
      setMsg(r);
      if (!r.error) router.refresh();
    });
  const t = { share: sum(view.map((b) => shareOf(b.propertyId) ?? 0)), f: sum(view.map((b) => row(b, '62603')?.f ?? 0)), ytd: sum(view.map((b) => row(b, '62603')?.ytd ?? 0)) };
  return (
    <div className="space-y-2 p-6">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-bold">Security allocation · watchmen by building · {year}B</h2>
        {edit && (
          <button className="btn-primary" onClick={save} disabled={pending || !Object.keys(drafts).length}>
            Save
          </button>
        )}
        <MsgLine msg={msg} />
        <span className="ml-auto text-sm">Cost per watchman: AED {fmt(cost)} a year (Assumptions)</span>
      </div>
      <table className="anh-grid">
        <thead>
          <tr className="h1">
            <th>Building</th>
            <th className="anh-num">Watchmen</th>
            <th className="anh-num">{year}B</th>
            <th className="anh-num">{ytdLabel(year, cutoff)}</th>
            <th className="anh-num">{year - 1}F</th>
          </tr>
        </thead>
        <tbody>
          {view.map((b) => {
            const s = shareOf(b.propertyId);
            const r = row(b, '62603');
            return (
              <tr key={b.propertyId}>
                <td>
                  {b.code} · {b.name}
                </td>
                {edit ? (
                  <NumInput value={drafts[b.propertyId] ?? (shares[b.propertyId] ? String(shares[b.propertyId]) : '')} onChange={(v) => setDrafts((x) => ({ ...x, [b.propertyId]: v }))} label={`${b.code} watchmen`} bad={parse(drafts[b.propertyId] ?? '') === 'bad'} />
                ) : (
                  <td className="anh-num locked">{s ?? ''}</td>
                )}
                <td className="anh-num calc">{fmt(watchmenBudget(s, cost))}</td>
                <td className="anh-num locked">{fmt(r?.ytd)}</td>
                <td className="anh-num locked">{fmt(r?.f)}</td>
              </tr>
            );
          })}
          <tr className="total">
            <td>Total · {view.length} buildings</td>
            <td className="anh-num">{Math.round(t.share * 100) / 100}</td>
            <td className="anh-num">{fmt(t.share * cost)}</td>
            <td className="anh-num">{fmt(t.ytd)}</td>
            <td className="anh-num">{fmt(t.f)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ---- contract schedules (AMC tabs) ------------------------------------------------------------------

type Draft = Omit<ContractRow, 'quantity' | 'rate'> & { key: string; quantity: string; rate: string };
const toDraft = (r: ContractRow): Draft => ({ ...r, key: `id${r.id}`, quantity: String(r.quantity), rate: String(r.rate) });

export function ContractSchedule({ blocks, versionId, year, cutoff, locked, kind, rows }: Common & { kind: ContractKind; rows: ContractRow[] }) {
  const router = useRouter();
  const info = CONTRACT_KIND.get(kind)!;
  const view = useView(blocks);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [lines, setLines] = useState<Draft[]>(() => rows.map(toDraft));
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [deleted, setDeleted] = useState<number[]>([]);
  const [addFor, setAddFor] = useState('');
  const seq = useRef(0);
  const may = (propertyId: number) => !locked && !!blocks.find((b) => b.propertyId === propertyId)?.editable;
  const editableBuildings = view.filter((b) => may(b.propertyId));
  const set = (key: string, patch: Partial<Draft>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setDirty((s) => new Set(s).add(key));
  };
  const add = () => {
    const pid = Number(addFor);
    if (!pid) return;
    const key = `new${++seq.current}`;
    setLines((ls) => [
      ...ls,
      { id: -1, key, propertyId: pid, kind, account: info.accounts[0], supplier: null, description: null, terms: 'Monthly', quantity: '12', rate: '', startMonth: null, remarks: null, source: 'PM', poNumber: null, poCategory: null, poStatus: null, poQuantity: null, poRate: null, poAmount: null },
    ]);
    setDirty((s) => new Set(s).add(key));
  };
  const remove = (l: Draft) => {
    setLines((ls) => ls.filter((x) => x.key !== l.key));
    if (l.id > 0) setDeleted((d) => [...d, l.id]);
  };
  const amountOf = (l: Draft) => {
    const q = parse(l.quantity);
    const r = parse(l.rate);
    return typeof q === 'number' && typeof r === 'number' ? contractAmount({ quantity: q, rate: r }) : null;
  };
  const save = () =>
    start(async () => {
      const changed = lines.filter((l) => dirty.has(l.key));
      if (changed.some((l) => typeof parse(l.quantity) !== 'number' || typeof parse(l.rate) !== 'number')) return setMsg({ error: 'Quantity and rate must be numbers' });
      const r = await saveContracts(versionId, kind, {
        lines: changed.map((l) => ({
          id: l.id > 0 ? l.id : null,
          propertyId: l.propertyId,
          account: l.account,
          supplier: l.supplier,
          description: l.description,
          terms: l.terms,
          quantity: parse(l.quantity),
          rate: parse(l.rate),
          startMonth: l.startMonth,
          remarks: l.remarks,
        })),
        deleted,
      });
      setMsg(r.errors.length ? { error: r.errors.join(' · ') } : { ok: `Saved ${r.saved}` });
      if (r.saved) router.refresh();
    });

  const inView = new Set(view.map((b) => b.propertyId));
  const groups = view.map((b) => ({ b, ls: lines.filter((l) => l.propertyId === b.propertyId) })).filter((g) => g.ls.length);
  const shown = groups.flatMap((g) => g.ls);
  const fOf = (b: BohBlock) => sum(info.accounts.map((acc) => row(b, acc)?.f ?? 0));
  const total = sum(shown.map((l) => amountOf(l) ?? 0));
  const text = (l: Draft, k: 'supplier' | 'description' | 'remarks', label: string, open: boolean) =>
    open ? (
      <td className="input">
        <input className="txt" aria-label={label} value={l[k] ?? ''} onChange={(e) => set(l.key, { [k]: e.target.value || null })} />
      </td>
    ) : (
      <td className="locked">{l[k] ?? ''}</td>
    );

  return (
    <div className="space-y-3 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-sm font-bold">
          {info.label} · {year}B
        </h2>
        {!locked && editableBuildings.length > 0 && (
          <>
            <select className="input w-64" value={addFor} onChange={(e) => setAddFor(e.target.value)} aria-label="Building for a new contract">
              <option value="">Building for a new contract…</option>
              {editableBuildings.map((b) => (
                <option key={b.propertyId} value={b.propertyId}>
                  {b.code} · {b.name}
                </option>
              ))}
            </select>
            <button className="btn" onClick={add} disabled={!addFor}>
              + Add contract
            </button>
            <button className="btn-primary" onClick={save} disabled={pending || (!dirty.size && !deleted.length)}>
              {pending ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
        <TemplateButtons kind={`amc-${kind}`} versionId={versionId} canImport={!locked} />
        <MsgLine msg={msg} />
      </div>

      <div className="anh-grid-wrap max-h-[calc(100vh-16rem)]">
        <table className="anh-grid">
          <thead>
            <tr className="h2">
              <th colSpan={7} />
              <th className="anh-num">{year}B</th>
              <th colSpan={3} style={{ textAlign: 'center' }}>
                Oracle purchase order
              </th>
              <th colSpan={2} />
            </tr>
            <tr className="h1">
              <th>Account</th>
              <th>Supplier</th>
              <th>Description</th>
              <th>Terms</th>
              <th>Start</th>
              <th className="anh-num">{info.quantity}</th>
              <th className="anh-num">{info.rate}</th>
              <th className="anh-num">Amount</th>
              <th>PO</th>
              <th>Category</th>
              <th className="anh-num">PO amount</th>
              <th>Remarks</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {groups.map(({ b, ls }) => (
              <Fragment key={b.propertyId}>
                <tr className="section">
                  <td colSpan={13}>
                    {b.code} · {b.name}
                    {b.pm && <span className="ml-2 font-normal">{b.pm}</span>}
                  </td>
                </tr>
                {ls.map((l) => {
                  const open = may(l.propertyId);
                  const amt = amountOf(l);
                  return (
                    <tr key={l.key} className="child">
                      {open ? (
                        <td className="input">
                          <select aria-label="Account" value={l.account} onChange={(e) => set(l.key, { account: e.target.value })}>
                            {info.accounts.map((acc) => (
                              <option key={acc} value={acc}>
                                {acc} {BOH_ACCOUNT.get(acc)?.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      ) : (
                        <td className="locked">
                          {l.account} {BOH_ACCOUNT.get(l.account)?.name}
                        </td>
                      )}
                      {text(l, 'supplier', 'Supplier', open)}
                      {text(l, 'description', 'Description', open)}
                      {open ? (
                        <td className="input">
                          <select aria-label="Terms" value={l.terms} onChange={(e) => set(l.key, { terms: e.target.value as ContractTerms })}>
                            {CONTRACT_TERMS.map((t) => (
                              <option key={t}>{t}</option>
                            ))}
                          </select>
                        </td>
                      ) : (
                        <td className="locked">{l.terms}</td>
                      )}
                      {open ? (
                        <td className="input">
                          <select aria-label="Start month" value={l.startMonth ?? ''} onChange={(e) => set(l.key, { startMonth: e.target.value ? Number(e.target.value) : null })}>
                            <option value="">Default</option>
                            {MONTHS.map((m, i) => (
                              <option key={m} value={i + 1}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </td>
                      ) : (
                        <td className="locked">{l.startMonth ? MONTHS[l.startMonth - 1] : ''}</td>
                      )}
                      {open ? <NumInput value={l.quantity} onChange={(v) => set(l.key, { quantity: v })} label="Quantity" bad={parse(l.quantity) === 'bad'} /> : <td className="anh-num locked">{l.quantity}</td>}
                      {open ? <NumInput value={l.rate} onChange={(v) => set(l.key, { rate: v })} label="Rate" bad={parse(l.rate) === 'bad'} /> : <td className="anh-num locked">{fmt(Number(l.rate))}</td>}
                      <td className={`anh-num calc${dirty.has(l.key) ? ' is-dirty' : ''}`}>{fmt(amt)}</td>
                      <td className="locked">{l.poNumber ?? ''}</td>
                      <td className="locked">{l.poCategory ?? ''}</td>
                      <td className="anh-num locked">{fmt(l.poAmount)}</td>
                      {text(l, 'remarks', 'Remarks', open)}
                      <td>
                        {open && l.source === 'PM' && (
                          <button className="btn btn-xs" onClick={() => remove(l)}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="subtotal">
                  <td colSpan={7}>
                    Total {b.code} · {year - 1}F {fmt(fOf(b))}
                  </td>
                  <td className="anh-num">{fmt(sum(ls.map((l) => amountOf(l) ?? 0)))}</td>
                  <td colSpan={5} />
                </tr>
              </Fragment>
            ))}
            {groups.length === 0 && (
              <tr>
                <td colSpan={13} className="is-empty">
                  No contracts for the buildings in view yet. Add one, or use the Excel template.
                </td>
              </tr>
            )}
            {groups.length > 0 && (
              <tr className="total">
                <td colSpan={7}>
                  Total · {groups.length} buildings · {year - 1}F {fmt(sum(groups.map((g) => fOf(g.b))))} · {ytdLabel(year, cutoff)} actual{' '}
                  {fmt(sum(groups.map((g) => sum(info.accounts.map((acc) => row(g.b, acc)?.ytd ?? 0)))))}
                </td>
                <td className="anh-num">{fmt(total)}</td>
                <td colSpan={5} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {lines.some((l) => !inView.has(l.propertyId)) && <p className="text-sm">Contracts of buildings outside the page filters are not shown.</p>}
    </div>
  );
}
