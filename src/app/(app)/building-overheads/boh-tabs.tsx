'use client';

// Building overheads' supporting tabs: Assumptions (percentages, cost per watchman, the insurance base
// per building), Security allocation (watchmen per building) and the contract schedules (AMC tabs, one
// component for all six). Each calculated budget shows next to last year's forecast.

import { Fragment, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fmt, MONTHS, sum } from '@/lib/format';
import { useFilters } from '@/components/filter-bar';
import { propertyPasses } from '@/lib/filters';
import { TemplateButtons } from '@/components/template-buttons';
import type { Assumptions } from '@/lib/engine/assumptions';
import { BOH_ACCOUNT, CONTRACT_KIND, CONTRACT_TERMS, type BohBlock, type ContractKind, type ContractRow, type ContractTerms } from '@/lib/budget/boh-types';
import { contractYear, parBudget, plBudget, watchmenBudget } from '@/lib/budget/boh-calc';
import { DateIn, FormField, FormGrid, FormSection, ListAndForm, NumIn, RecordForm, SelectIn, Show, TextIn, useDraft } from '@/components/record-form';
import { InsuranceForm, WatchmenForm, useOpen } from './boh-finance-forms';
import type { InsuranceRow } from '@/lib/budget/boh-schedules';
import { saveBohAssumptions, saveContracts, saveInsurance, saveWatchmen } from './actions';

interface Common {
  blocks: BohBlock[];
  versionId: number;
  year: number;
  cutoff: number;
  locked: boolean;
  /** enters Finance's inputs (insurance, security allocation) */
  finance: boolean;
  /** sets the assumptions */
  admin: boolean;
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

export function BohAssumptions({ blocks, versionId, year, cutoff, locked, finance, admin, assumptions, insurance }: Common & { assumptions: Assumptions; insurance: InsuranceRow[] }) {
  const router = useRouter();
  const view = useView(blocks);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [open, setOpen] = useOpen('insurance');
  // Admin sets the assumptions; Finance enters the insurance base
  const edit = admin && !locked;
  const editIns = finance && !locked;
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

  const openIdx = view.findIndex((b) => b.propertyId === open);
  const form = openIdx >= 0 && (
    <InsuranceForm
      key={view[openIdx].propertyId}
      block={view[openIdx]}
      year={year}
      canEdit={editIns}
      versionId={versionId}
      insurance={byId.get(view[openIdx].propertyId)}
      parPct={pct('insParPct')}
      plPct={pct('insPlPct')}
      onClose={() => setOpen(null)}
      onPrev={openIdx > 0 ? () => setOpen(view[openIdx - 1].propertyId) : undefined}
      onNext={openIdx < view.length - 1 ? () => setOpen(view[openIdx + 1].propertyId) : undefined}
    />
  );
  return (
    <ListAndForm form={form}>
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
          {editIns && (
            <button className="btn-primary" onClick={saveI} disabled={pending || !Object.keys(drafts).length}>
              Save insurance
            </button>
          )}
        </div>
        <div className="anh-grid-wrap">
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
                <tr key={b.propertyId} className={open === b.propertyId ? 'is-selected' : undefined}>
                  <td className="cursor-pointer" onClick={() => setOpen(b.propertyId)} title="Open in the form">
                    {b.code} · {b.name}
                  </td>
                  {editIns ? <NumInput value={d.value} onChange={set('value')} label={`${b.code} insured value`} bad={parse(d.value) === 'bad'} /> : <td className="anh-num locked">{fmt(v.value)}</td>}
                  {editIns ? <NumInput value={d.rate} onChange={set('rate')} label={`${b.code} PAR rate`} bad={parse(d.rate) === 'bad'} /> : <td className="anh-num locked">{d.rate}</td>}
                  <td className="anh-num calc">{fmt(par)}</td>
                  {editIns ? <NumInput value={d.pl} onChange={set('pl')} label={`${b.code} liability premium`} bad={parse(d.pl) === 'bad'} /> : <td className="anh-num locked">{fmt(v.pl)}</td>}
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
        </div>
      </section>
    </div>
    </ListAndForm>
  );
}

// ---- Security allocation --------------------------------------------------------------------------------

export function SecurityAllocation({ blocks, versionId, year, cutoff, locked, finance, cost, shares }: Common & { cost: number; shares: Record<number, number> }) {
  const router = useRouter();
  const view = useView(blocks);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [open, setOpen] = useOpen('watchmen');
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
  const openIdx = view.findIndex((b) => b.propertyId === open);
  const form = openIdx >= 0 && (
    <WatchmenForm
      key={view[openIdx].propertyId}
      block={view[openIdx]}
      year={year}
      canEdit={edit}
      versionId={versionId}
      share={shares[view[openIdx].propertyId] ?? null}
      cost={cost}
      onClose={() => setOpen(null)}
      onPrev={openIdx > 0 ? () => setOpen(view[openIdx - 1].propertyId) : undefined}
      onNext={openIdx < view.length - 1 ? () => setOpen(view[openIdx + 1].propertyId) : undefined}
    />
  );
  return (
    <ListAndForm form={form}>
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
      <div className="anh-grid-wrap">
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
              <tr key={b.propertyId} className={open === b.propertyId ? 'is-selected' : undefined}>
                <td className="cursor-pointer" onClick={() => setOpen(b.propertyId)} title="Open in the form">
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
    </div>
    </ListAndForm>
  );
}

// ---- contract schedules (AMC tabs): the list and the side form, as the Lease Budget -------------------

type ContractDraft = Omit<ContractRow, 'id'> & { id: number | null };
const TERMS_OPTIONS = CONTRACT_TERMS.map((t) => ({ value: t, label: t }));
const dmy = (v: string | null) => (v ? new Date(`${v}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/ /g, '-') : '');

export function ContractSchedule({ blocks, versionId, year, cutoff, locked, kind, rows }: Common & { kind: ContractKind; rows: ContractRow[] }) {
  const router = useRouter();
  const info = CONTRACT_KIND.get(kind)!;
  const view = useView(blocks);
  const [selected, setSelected] = useState<number | 'new' | null>(null);
  const [newFor, setNewFor] = useState('');
  const may = (propertyId: number) => !locked && !!blocks.find((b) => b.propertyId === propertyId)?.editable;
  const editableBuildings = view.filter((b) => may(b.propertyId));
  const inView = new Set(view.map((b) => b.propertyId));
  const shown = rows.filter((r) => inView.has(r.propertyId));
  const yearOf = (r: ContractDraft) => contractYear(r, year);
  const groups = view.map((b) => ({ b, ls: shown.filter((l) => l.propertyId === b.propertyId) })).filter((g) => g.ls.length);
  const order = groups.flatMap((g) => g.ls);
  const flagged = order.filter((r) => yearOf(r).needsDecision).length;
  const fOf = (b: BohBlock) => sum(info.accounts.map((acc) => row(b, acc)?.f ?? 0));

  const blank = (propertyId: number): ContractDraft => ({
    id: null, propertyId, kind, account: info.accounts[0], supplier: null, description: null, terms: 'Monthly', quantity: 12, rate: 0, startMonth: null,
    startDate: `${year}-01-01`, endDate: `${year}-12-31`, renewal: null, renewalRate: null, renewalTerms: null, remarks: null, source: 'PM',
    poNumber: null, poCategory: null, poStatus: null, poQuantity: null, poRate: null, poAmount: null,
  });
  const current: ContractDraft | null = selected === 'new' ? (newFor ? blank(Number(newFor)) : null) : (order.find((r) => r.id === selected) ?? null);
  const idx = typeof selected === 'number' ? order.findIndex((r) => r.id === selected) : -1;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 space-y-3 overflow-auto p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-sm font-bold">
            {info.label} · {year}B
          </h2>
          {!locked && editableBuildings.length > 0 && (
            <>
              <select className="input w-64" value={newFor} onChange={(e) => setNewFor(e.target.value)} aria-label="Building for a new contract">
                <option value="">Building for a new contract…</option>
                {editableBuildings.map((b) => (
                  <option key={b.propertyId} value={b.propertyId}>
                    {b.code} · {b.name}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={() => setSelected('new')} disabled={!newFor}>
                + Add contract
              </button>
            </>
          )}
          <TemplateButtons kind={`amc-${kind}`} versionId={versionId} canImport={!locked} />
          {flagged > 0 && <span className="text-sm text-amber-700">{flagged} contract{flagged === 1 ? ' ends' : 's end'} before 31-Dec-{year} without a renewal decision</span>}
        </div>

        <div className="anh-grid-wrap">
          <table className="anh-grid w-full">
            <thead>
              <tr className="h1">
                <th>Account</th>
                <th>Supplier · description</th>
                <th>Period</th>
                <th>Terms</th>
                <th className="anh-num">Contract value</th>
                <th className="anh-num">{year}B</th>
                <th>PO</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {groups.map(({ b, ls }) => (
                <Fragment key={b.propertyId}>
                  <tr className="section">
                    <td colSpan={8}>
                      {b.code} · {b.name}
                      {b.pm && <span className="ml-2 font-normal">{b.pm}</span>}
                    </td>
                  </tr>
                  {ls.map((l) => {
                    const y = yearOf(l);
                    return (
                      <tr key={l.id} className={`child cursor-pointer ${selected === l.id ? 'is-selected' : ''}`} onClick={() => setSelected(l.id)}>
                        <td>
                          {l.account} {BOH_ACCOUNT.get(l.account)?.name}
                        </td>
                        <td className="max-w-[18rem] truncate" title={l.description ?? undefined}>
                          {[l.supplier, l.description].filter(Boolean).join(' · ')}
                        </td>
                        <td className="whitespace-nowrap">
                          {dmy(y.start)} – {dmy(y.end)}
                        </td>
                        <td>{l.terms}</td>
                        <td className="anh-num">{fmt(l.quantity * l.rate)}</td>
                        <td className="anh-num calc">{fmt(y.total)}</td>
                        <td>{l.poNumber ?? ''}</td>
                        <td className="whitespace-nowrap text-xs">
                          {y.needsDecision ? <span className="text-amber-700">Ends {dmy(y.end)}: renew?</span> : y.endsBeforeYearEnd ? (l.renewal === 'RENEW' ? 'Renewed' : 'Ends') : ''}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="subtotal">
                    <td colSpan={5}>
                      Total {b.code} · {year - 1}F {fmt(fOf(b))}
                    </td>
                    <td className="anh-num">{fmt(sum(ls.map((l) => yearOf(l).total)))}</td>
                    <td colSpan={2} />
                  </tr>
                </Fragment>
              ))}
              {groups.length === 0 && (
                <tr>
                  <td colSpan={8} className="is-empty">
                    No contracts for the buildings in view yet. Add one, or use the Excel template.
                  </td>
                </tr>
              )}
              {groups.length > 0 && (
                <tr className="total">
                  <td colSpan={5}>
                    Total · {groups.length} buildings · {year - 1}F {fmt(sum(groups.map((g) => fOf(g.b))))} · {ytdLabel(year, cutoff)} actual{' '}
                    {fmt(sum(groups.map((g) => sum(info.accounts.map((acc) => row(g.b, acc)?.ytd ?? 0)))))}
                  </td>
                  <td className="anh-num">{fmt(sum(order.map((l) => yearOf(l).total)))}</td>
                  <td colSpan={2} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.some((l) => !inView.has(l.propertyId)) && <p className="text-sm">Contracts of buildings outside the page filters are not shown.</p>}
      </div>

      {current && (
        <ContractForm
          key={`${current.id ?? 'new'}-${current.propertyId}`}
          record={current}
          info={info}
          year={year}
          building={blocks.find((b) => b.propertyId === current.propertyId)}
          canEdit={may(current.propertyId)}
          versionId={versionId}
          kind={kind}
          onClose={() => setSelected(null)}
          onPrev={idx > 0 ? () => setSelected(order[idx - 1].id) : undefined}
          onNext={idx >= 0 && idx < order.length - 1 ? () => setSelected(order[idx + 1].id) : undefined}
          onSaved={(close) => {
            if (close) setSelected(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ContractForm({
  record,
  info,
  year,
  building,
  canEdit,
  versionId,
  kind,
  onClose,
  onPrev,
  onNext,
  onSaved,
}: {
  record: ContractDraft;
  info: NonNullable<ReturnType<typeof CONTRACT_KIND.get>>;
  year: number;
  building: BohBlock | undefined;
  canEdit: boolean;
  versionId: number;
  kind: ContractKind;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onSaved: (close: boolean) => void;
}) {
  const d = useDraft(record);
  const v = d.value;
  const [saving, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const y = contractYear(v, year);
  const po = v.source === 'PO';
  const fixedPo = po ? 'From the Oracle purchase order' : false;
  const save = () =>
    start(async () => {
      if (!(v.quantity >= 0) || !(v.rate >= 0)) return setError('Quantity and rate must be numbers');
      if (v.startDate && v.endDate && v.endDate < v.startDate) return setError('The contract ends before it starts');
      if (y.endsBeforeYearEnd && v.renewal === 'RENEW' && v.renewalRate === null) return setError('Enter the renewal rate, or choose that it ends');
      const r = await saveContracts(versionId, kind, {
        lines: [{ id: v.id, propertyId: v.propertyId, account: v.account, supplier: v.supplier, description: v.description, terms: v.terms, quantity: v.quantity, rate: v.rate, startMonth: v.startMonth, startDate: v.startDate, endDate: v.endDate, renewal: v.renewal, renewalRate: v.renewalRate, renewalTerms: v.renewalTerms, remarks: v.remarks }],
        deleted: [],
      });
      if (r.errors.length) return setError(r.errors.join(' · '));
      setError(null);
      d.reset();
      onSaved(v.id === null);
    });
  const remove = () =>
    start(async () => {
      if (v.id === null) return onClose();
      const r = await saveContracts(versionId, kind, { lines: [], deleted: [v.id] });
      if (r.errors.length) return setError(r.errors.join(' · '));
      onSaved(true);
    });
  const flags = y.needsDecision ? [`The contract ends on ${dmy(y.end)}, before 31-Dec-${year}: say whether it is renewed, at what rate and on what terms, or that it ends. The property can't be submitted until then.`] : [];

  return (
    <RecordForm
      title={`${v.supplier ?? (v.id === null ? 'New contract' : 'Contract')} · ${info.label}`}
      subtitle={building ? `${building.code} · ${building.name}${v.poNumber ? ` · PO ${v.poNumber}` : ''}` : undefined}
      flags={flags}
      canEdit={canEdit}
      dirty={v.id === null ? Math.max(d.dirty, 1) : d.dirty}
      saving={saving}
      error={error}
      onSave={save}
      onCancel={() => (d.reset(), setError(null))}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      onDelete={!po ? remove : undefined}
      deleteLabel={v.id === null ? 'Discard' : 'Remove this contract'}
    >
      <FormSection title="Contract" note={po ? 'Supplier and PO from Oracle' : undefined}>
        <FormGrid>
          <FormField label="Account">
            <SelectIn value={v.account} enabled={canEdit} changed={d.changed('account')} onChange={(x) => x && d.set('account', x)} options={info.accounts.map((a) => ({ value: a, label: `${a} ${BOH_ACCOUNT.get(a)?.name ?? ''}` }))} />
          </FormField>
          <FormField label="Supplier" locked={fixedPo}>
            <TextIn value={v.supplier} enabled={canEdit && !po} changed={d.changed('supplier')} onChange={(x) => d.set('supplier', x)} />
          </FormField>
          <FormField label="Description" wide>
            <TextIn value={v.description} enabled={canEdit} changed={d.changed('description')} onChange={(x) => d.set('description', x)} />
          </FormField>
        </FormGrid>
      </FormSection>

      <FormSection title="Period and price" note="Only the part of the contract inside the year is booked">
        <FormGrid>
          <FormField label="Start" hint={v.startDate ? undefined : 'Blank: from the start month for a year'}>
            <DateIn value={v.startDate} enabled={canEdit} changed={d.changed('startDate')} onChange={(x) => d.set('startDate', x)} placeholder={y.start} />
          </FormField>
          <FormField label="End">
            <DateIn value={v.endDate} enabled={canEdit} changed={d.changed('endDate')} onChange={(x) => d.set('endDate', x)} placeholder={y.end} />
          </FormField>
          <FormField label="Terms" hint="How it is paid">
            <SelectIn value={v.terms} enabled={canEdit} changed={d.changed('terms')} onChange={(x) => x && d.set('terms', x)} options={TERMS_OPTIONS} />
          </FormField>
          <FormField label={info.quantity}>
            <NumIn value={v.quantity} enabled={canEdit} changed={d.changed('quantity')} onChange={(x) => d.set('quantity', x ?? 0)} />
          </FormField>
          <FormField label={info.rate}>
            <NumIn value={v.rate} enabled={canEdit} changed={d.changed('rate')} onChange={(x) => d.set('rate', x ?? 0)} />
          </FormField>
          <FormField label="Contract value" hint="Quantity × rate, for the whole period">
            <Show right>{fmt(v.quantity * v.rate)}</Show>
          </FormField>
        </FormGrid>
      </FormSection>

      {y.endsBeforeYearEnd && (
        <FormSection title={`Renewal · ends ${dmy(y.end)}`} note="Before 31 December: the property manager decides">
          <FormGrid>
            <FormField label="Decision">
              <SelectIn
                value={v.renewal}
                enabled={canEdit}
                changed={d.changed('renewal')}
                blank="Not decided"
                onChange={(x) => d.set('renewal', x as ContractDraft['renewal'])}
                options={[
                  { value: 'RENEW', label: 'Renewed' },
                  { value: 'END', label: 'Ends, not renewed' },
                ]}
              />
            </FormField>
            {v.renewal === 'RENEW' && (
              <>
                <FormField label={`New ${info.rate.toLowerCase()}`} hint="Same quantity and length as now">
                  <NumIn value={v.renewalRate} enabled={canEdit} changed={d.changed('renewalRate')} onChange={(x) => d.set('renewalRate', x)} placeholder={String(v.rate)} />
                </FormField>
                <FormField label="New terms">
                  <SelectIn value={v.renewalTerms} enabled={canEdit} changed={d.changed('renewalTerms')} blank="As now" onChange={(x) => d.set('renewalTerms', x as ContractTerms | null)} options={TERMS_OPTIONS} />
                </FormField>
              </>
            )}
          </FormGrid>
        </FormSection>
      )}

      <FormSection title={`Result ${year}`} tone="calc" note="Recalculated as you type">
        <FormGrid>
          <FormField label={`${year}B expense`}>
            <Show right>{fmt(y.total)}</Show>
          </FormField>
          <FormField label={`Paid in ${year}`}>
            <Show right>{fmt(sum(y.cash))}</Show>
          </FormField>
          <FormField label="Months booked">
            <Show>{y.expense.map((x, i) => (x > 0.004 ? MONTHS[i] : null)).filter(Boolean).join(' ')}</Show>
          </FormField>
        </FormGrid>
      </FormSection>

      {po && (
        <FormSection title="Oracle purchase order" tone="fixed" note="For reference">
          <FormGrid>
            <FormField label="PO">
              <Show>{v.poNumber}</Show>
            </FormField>
            <FormField label="Category">
              <Show>{v.poCategory}</Show>
            </FormField>
            <FormField label="PO amount">
              <Show right>{fmt(v.poAmount)}</Show>
            </FormField>
          </FormGrid>
        </FormSection>
      )}

      <FormSection title="Remarks">
        <TextIn value={v.remarks} enabled={canEdit} changed={d.changed('remarks')} onChange={(x) => d.set('remarks', x)} />
      </FormSection>
    </RecordForm>
  );
}