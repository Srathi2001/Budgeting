'use client';

// FM Budget: facilities of the selection, one facility in detail. Facts that come from the tool (the
// facility, the Lease Budget, last year's budget and actuals, lines carried from last year) are read
// only; FMD enters the lines and the staff budget, submits each facility, Finance approves.

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fmt, MONTHS, sum } from '@/lib/format';
import { StatusBadge } from '@/components/status-badge';
import { BUSINESS_NEEDS, ELEMENTS, FM_KINDS, FM_KIND_LABEL, STAFF_TEAMS, WORK_TYPE, WORK_TYPES, elementLabel, glOf, type FmKind, type WorkType } from '@/lib/budget/fm-types';
import type { FmLineRow, FmPageData } from '@/lib/budget/fm-page';
import { fmTransition, saveFmLines, saveFmStaff } from './actions';

type Draft = FmLineRow & { key: string; amountText: string };
const toDraft = (l: FmLineRow): Draft => ({ ...l, key: `id${l.id}`, amountText: String(l.amount) });
const parseAmount = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ''));
  return s.trim() === '' ? 0 : Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const SOURCE: Record<string, string> = { FMD_2026: 'FMD file', CARRIED: 'Carried from last year', FM: 'Entered' };

function useMsg() {
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const Msg = () => (msg ? <span className={msg.error ? 'text-sm text-red-600' : 'text-sm'}>{msg.error ?? msg.ok}</span> : null);
  return { setMsg, Msg };
}

export function FmBudget({ data }: { data: FmPageData }) {
  const { version, facilities, detail } = data;
  const T = {
    prior: facilities.some((f) => f.prior !== null) ? sum(facilities.map((f) => f.prior ?? 0)) : null,
    actual: sum(facilities.map((f) => f.actual)),
    budget: sum(facilities.map((f) => f.budget)),
    staff: sum(facilities.map((f) => f.staff)),
  };
  const priorLabel = data.priorName ? `${version.year - 1}B` : null;
  return (
    <div className="space-y-5 p-6">
      <header>
        <h1 className="page-title">FM Budget · {version.name}</h1>
        <p className="page-sub">Facilities management cost budget by facility: maintenance, renewal, capex and FM staff · AED</p>
      </header>

      <div className="anh-grid-wrap max-h-[22rem]">
        <table className="anh-grid">
          <thead>
            <tr className="h1">
              <th>Facility</th>
              <th>BU</th>
              <th>Zone</th>
              <th>Status</th>
              {priorLabel && <th className="anh-num">{priorLabel} works</th>}
              <th className="anh-num">{data.actualLabel}</th>
              <th className="anh-num">{version.year}B works</th>
              <th className="anh-num">FM staff</th>
              <th className="anh-num">{version.year}B total</th>
            </tr>
          </thead>
          <tbody>
            {facilities.map((f) => (
              <tr key={f.id} className={f.id === detail?.id ? 'is-current' : undefined}>
                <td>
                  <Link href={`/fm?f=${f.id}`} scroll={false} className={f.id === detail?.id ? 'font-bold' : 'hover:underline'}>
                    {f.code} · {f.name}
                  </Link>
                </td>
                <td>{f.bu}</td>
                <td>{f.zone?.replace('ZONE_', 'Zone ') ?? ''}</td>
                <td>
                  <StatusBadge status={f.status} />
                </td>
                {priorLabel && <td className="anh-num">{fmt(f.prior)}</td>}
                <td className="anh-num">{fmt(f.actual)}</td>
                <td className="anh-num">{fmt(f.budget)}</td>
                <td className="anh-num">{fmt(f.staff)}</td>
                <td className="anh-num">{fmt(f.budget + f.staff)}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Total · {facilities.length} facilities</td>
              <td />
              <td />
              <td />
              {priorLabel && <td className="anh-num">{fmt(T.prior)}</td>}
              <td className="anh-num">{fmt(T.actual)}</td>
              <td className="anh-num">{fmt(T.budget)}</td>
              <td className="anh-num">{fmt(T.staff)}</td>
              <td className="anh-num">{fmt(T.budget + T.staff)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {detail ? <FacilityDetail data={data} /> : <p>No facility in the current filters.</p>}
      <StaffCard data={data} />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-bold">{label}</div>
      <div className="text-sm">{value === null || value === '' ? '—' : value}</div>
    </div>
  );
}

function FacilityDetail({ data }: { data: FmPageData }) {
  const d = data.detail!;
  const { version } = data;
  const router = useRouter();
  const [pending, start] = useTransition();
  const { setMsg, Msg } = useMsg();
  const [lines, setLines] = useState<Draft[]>(() => d.lines.map(toDraft));
  const [deleted, setDeleted] = useState<number[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [note, setNote] = useState(d.note ?? '');
  const age = d.activeSince ? Math.floor((Date.parse(`${version.year}-01-01`) - Date.parse(d.activeSince)) / (365.25 * 864e5)) : null;
  const edit = d.canEdit;

  const set = (key: string, patch: Partial<Draft>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setDirty((s) => new Set(s).add(key));
  };
  const add = () => {
    const key = `new${Date.now()}`;
    setLines((ls) => [...ls, { id: null as unknown as number, key, workType: 'M02', element: '32', subElement: null, description: null, businessNeed: 'Functional', kind: 'PLANNED', amount: 0, month: null, remarks: null, source: 'FM', amountText: '' }]);
    setDirty((s) => new Set(s).add(key));
  };
  const remove = (l: Draft) => {
    setLines((ls) => ls.filter((x) => x.key !== l.key));
    if (l.id) setDeleted((x) => [...x, l.id]);
  };
  const bad = lines.filter((l) => parseAmount(l.amountText) === null);
  const changed = dirty.size > 0 || deleted.length > 0;
  const total = sum(lines.map((l) => parseAmount(l.amountText) ?? 0));
  const byType = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l.workType, (m.get(l.workType) ?? 0) + (parseAmount(l.amountText) ?? 0));
    return m;
  }, [lines]);

  const save = () =>
    start(async () => {
      if (bad.length) return setMsg({ error: 'Amounts must be numbers of 0 or more' });
      const r = await saveFmLines(version.id, d.id, {
        lines: lines.map((l) => ({
          id: l.id ?? null,
          workType: l.workType,
          element: l.element,
          subElement: l.subElement,
          description: l.description,
          businessNeed: l.businessNeed,
          kind: l.kind,
          amount: parseAmount(l.amountText) ?? 0,
          month: l.month,
          remarks: l.remarks,
        })),
        deleted,
      });
      setMsg(r);
      if (!r.error) {
        setDirty(new Set());
        setDeleted([]);
        router.refresh();
      }
    });
  const transition = (action: 'submit' | 'approve' | 'return') =>
    start(async () => {
      if (action === 'submit' && changed) return setMsg({ error: 'Save the changes first' });
      const r = await fmTransition(version.id, d.id, action, note);
      setMsg(r);
      if (!r.error) router.refresh();
    });

  const assets = Object.entries(d.assets ?? {}).sort((a, b) => b[1] - a[1]);
  const priorCol = d.compare.some((c) => c.prior !== null);
  const textCell = (l: Draft, k: 'subElement' | 'description' | 'remarks', frozen: boolean, label: string) =>
    edit && !frozen ? (
      <td className={`input${dirty.has(l.key) ? ' is-dirty' : ''}`}>
        <input className="txt" aria-label={label} value={l[k] ?? ''} onChange={(e) => set(l.key, { [k]: e.target.value || null })} />
      </td>
    ) : (
      <td className="locked">{l[k] ?? ''}</td>
    );
  const choice = (l: Draft, value: string, options: { v: string; t: string }[], onChange: (v: string) => void, frozen: boolean, label: string, shown?: string) =>
    edit && !frozen ? (
      <td className="input">
        <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.v} value={o.v}>
              {o.t}
            </option>
          ))}
        </select>
      </td>
    ) : (
      <td className="locked">{shown ?? options.find((o) => o.v === value)?.t ?? value}</td>
    );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">
          {d.code} · {d.name}
        </h2>
        <StatusBadge status={d.status} />
      </div>

      <div className="card grid grid-cols-2 gap-x-6 gap-y-3 p-4 md:grid-cols-4 xl:grid-cols-6">
        <Fact label="Business unit" value={`${d.bu} ${d.buName}`} />
        <Fact label="Property manager" value={d.pm} />
        <Fact label="FM zone" value={d.zone?.replace('ZONE_', 'Zone ') ?? null} />
        <Fact label="In service since" value={d.activeSince ? `${d.activeSince.slice(0, 4)}${age !== null ? ` · ${age} years` : ''}` : null} />
        <Fact label="Gross area, sq ft" value={d.grossArea ? fmt(d.grossArea) : null} />
        <Fact label="Lettable area, sq ft" value={d.lettableArea ? fmt(d.lettableArea) : null} />
        <Fact label="Units" value={fmt(d.units)} />
        <Fact label="Leased now" value={fmt(d.leased)} />
        <Fact label="Vacant now" value={d.vacant ? fmt(d.vacant) : '0'} />
        <Fact label={`Moving out in ${version.year}`} value={d.moveOuts ? fmt(d.moveOuts) : '0'} />
        <Fact label={`Rental revenue ${version.year}B`} value={fmt(d.revenue)} />
        {d.priorRevenue !== null && <Fact label={`Rental revenue ${version.year - 1}B`} value={fmt(d.priorRevenue)} />}
        {assets.length > 0 && (
          <div className="col-span-2 md:col-span-4 xl:col-span-6">
            <div className="text-xs font-bold">HVAC assets</div>
            <div className="text-sm">{assets.map(([k, n]) => `${k} ${n}`).join(' · ')}</div>
          </div>
        )}
      </div>

      <div className="anh-grid-wrap max-w-5xl">
        <table className="anh-grid">
          <thead>
            <tr className="h1">
              <th>Work type</th>
              {priorCol && <th className="anh-num">{version.year - 1}B</th>}
              <th className="anh-num">{data.actualLabel}</th>
              <th className="anh-num">{version.year}B</th>
              {priorCol && <th className="anh-num">Change</th>}
            </tr>
          </thead>
          <tbody>
            {d.compare.map((c) => (
              <tr key={c.key} className={c.key === 'staff' ? 'subtotal' : undefined}>
                <td>
                  {c.key !== 'staff' && c.key !== 'other' && <span className="anh-code mr-2">{c.key}</span>}
                  {c.label}
                </td>
                {priorCol && <td className="anh-num locked">{fmt(c.prior)}</td>}
                <td className="anh-num locked">{c.actual === null ? '' : fmt(c.actual)}</td>
                <td className="anh-num calc">{fmt(c.key === 'staff' || c.key === 'other' ? c.budget : (byType.get(c.key) ?? 0))}</td>
                {priorCol && <td className="anh-num">{c.prior === null ? '' : fmt((c.key === 'staff' || c.key === 'other' ? c.budget : (byType.get(c.key) ?? 0)) - c.prior)}</td>}
              </tr>
            ))}
            <tr className="total">
              <td>Total</td>
              {priorCol && <td className="anh-num">{fmt(sum(d.compare.map((c) => c.prior ?? 0)))}</td>}
              <td className="anh-num">{fmt(sum(d.compare.map((c) => c.actual ?? 0)))}</td>
              <td className="anh-num">{fmt(total + (d.compare.find((c) => c.key === 'staff')?.budget ?? 0))}</td>
              {priorCol && <td className="anh-num">{fmt(total + (d.compare.find((c) => c.key === 'staff')?.budget ?? 0) - sum(d.compare.map((c) => c.prior ?? 0)))}</td>}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-bold">Budget lines · {lines.length}</h3>
        {edit && (
          <>
            <button className="btn" onClick={add} disabled={pending}>
              Add line
            </button>
            <button className="btn-primary" onClick={save} disabled={pending || !changed}>
              {pending ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
        {!edit && d.reason && <span className="text-sm">{d.reason}</span>}
        <Msg />
        <div className="anh-legend-cells ml-auto" aria-label="Cell legend">
          <span>
            <i className="input" />
            To enter
          </span>
          <span>
            <i className="locked" />
            From the tool, read only
          </span>
        </div>
      </div>

      <div className="anh-grid-wrap max-h-[calc(100vh-12rem)]">
        <table className="anh-grid">
          <thead>
            <tr className="h1">
              <th>Work type</th>
              <th>Element · GL</th>
              <th>Sub-element</th>
              <th>Description of works</th>
              <th>Business need</th>
              <th>Type</th>
              <th>Month</th>
              <th className="anh-num">Amount</th>
              <th>Remarks</th>
              <th>Source</th>
              {edit && <th />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              // lines from the FMD file or carried from last year: what the work is stays as it is
              const frozen = l.source !== 'FM';
              const spread = WORK_TYPE.get(l.workType as WorkType)?.spread ?? true;
              return (
                <tr key={l.key}>
                  {choice(l, l.workType, WORK_TYPES.map((w) => ({ v: w.code, t: `${w.code} ${w.label}` })), (v) => set(l.key, { workType: v, month: WORK_TYPE.get(v as WorkType)?.spread ? null : l.month }), frozen, 'Work type')}
                  {choice(
                    l,
                    l.element,
                    ELEMENTS.map((e) => ({ v: e.code, t: `${glOf(l.workType, e.code)} ${e.label}` })),
                    (v) => set(l.key, { element: v }),
                    frozen,
                    'Building element',
                    `${glOf(l.workType, l.element)} ${elementLabel(l.element)}`,
                  )}
                  {textCell(l, 'subElement', frozen, 'Sub-element')}
                  {textCell(l, 'description', frozen, 'Description of works')}
                  {choice(l, l.businessNeed ?? '', [{ v: '', t: '' }, ...BUSINESS_NEEDS.map((b) => ({ v: b, t: b }))], (v) => set(l.key, { businessNeed: v || null }), false, 'Business need')}
                  {choice(l, l.kind, FM_KINDS.map((k) => ({ v: k.code, t: k.label })), (v) => set(l.key, { kind: v }), false, 'Type', FM_KIND_LABEL[l.kind as FmKind])}
                  {spread ? (
                    <td className="locked">Jan–Dec</td>
                  ) : (
                    choice(l, String(l.month ?? ''), [{ v: '', t: 'Jan–Dec' }, ...MONTHS.map((m, i) => ({ v: String(i + 1), t: m }))], (v) => set(l.key, { month: v ? Number(v) : null }), false, 'Month')
                  )}
                  {edit ? (
                    <td className={`input${dirty.has(l.key) ? ' is-dirty' : ''}${parseAmount(l.amountText) === null ? ' is-error' : ''}`}>
                      <input aria-label="Amount" inputMode="decimal" value={l.amountText} onChange={(e) => set(l.key, { amountText: e.target.value })} />
                    </td>
                  ) : (
                    <td className="anh-num locked">{fmt(l.amount)}</td>
                  )}
                  {textCell(l, 'remarks', false, 'Remarks')}
                  <td className="locked">{SOURCE[l.source] ?? l.source}</td>
                  {edit && (
                    <td>
                      {!frozen && (
                        <button className="anh-btn anh-btn--secondary anh-btn--sm" onClick={() => remove(l)} aria-label="Remove line">
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            <tr className="total">
              <td colSpan={7}>Total works</td>
              <td className="anh-num">{fmt(total)}</td>
              <td colSpan={edit ? 3 : 2} />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card flex flex-wrap items-center gap-3 p-3">
        <span className="text-sm font-bold">Approval</span>
        <StatusBadge status={d.status} />
        <input className="input min-w-[20rem] flex-1" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} disabled={version.locked} />
        {!version.locked && (d.status === 'DRAFT' || d.status === 'RETURNED') && (data.finance || d.canEdit) && (
          <button className="btn-primary" disabled={pending} onClick={() => transition('submit')}>
            Submit to Finance
          </button>
        )}
        {!version.locked && data.finance && d.status === 'SUBMITTED' && (
          <button className="btn-primary" disabled={pending} onClick={() => transition('approve')}>
            Approve
          </button>
        )}
        {!version.locked && data.finance && (d.status === 'SUBMITTED' || d.status === 'APPROVED') && (
          <button className="btn" disabled={pending} onClick={() => transition('return')}>
            Return for changes
          </button>
        )}
      </div>
    </section>
  );
}

function StaffCard({ data }: { data: FmPageData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { setMsg, Msg } = useMsg();
  const [rows, setRows] = useState(() => data.staff.map((s) => ({ ...s, ctcText: String(s.ctc), otText: String(s.overtime) })));
  const [dirty, setDirty] = useState(false);
  const edit = data.canEditStaff;
  const share = data.detail?.staffByTeam ?? {};
  const save = () =>
    start(async () => {
      const parsed = rows.map((r) => ({ team: r.team, ctc: parseAmount(r.ctcText), overtime: parseAmount(r.otText) }));
      if (parsed.some((p) => p.ctc === null || p.overtime === null)) return setMsg({ error: 'Amounts must be numbers of 0 or more' });
      const r = await saveFmStaff(data.version.id, parsed);
      setMsg(r);
      if (!r.error) {
        setDirty(false);
        router.refresh();
      }
    });
  const label = new Map(STAFF_TEAMS.map((t) => [t.code, t]));
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">FM staff · {data.version.year}B</h2>
        {edit && (
          <button className="btn-primary" onClick={save} disabled={pending || !dirty}>
            {pending ? 'Saving…' : 'Save staff'}
          </button>
        )}
        <Msg />
      </div>
      <div className="anh-grid-wrap max-w-5xl">
        <table className="anh-grid">
          <thead>
            <tr className="h1">
              <th>Team</th>
              <th>Spread over</th>
              <th className="anh-num">Cost to company</th>
              <th className="anh-num">Overtime</th>
              <th className="anh-num">With G&amp;A share</th>
              {data.detail && <th className="anh-num">{data.detail.code}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const t = label.get(r.team)!;
              const cell = (k: 'ctcText' | 'otText', aria: string) =>
                edit && !(k === 'otText' && r.team === 'GA') ? (
                  <td className={`input${parseAmount(r[k]) === null ? ' is-error' : ''}`}>
                    <input
                      aria-label={`${t.label} ${aria}`}
                      inputMode="decimal"
                      value={r[k]}
                      onChange={(e) => {
                        setRows((rs) => rs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));
                        setDirty(true);
                      }}
                    />
                  </td>
                ) : (
                  <td className="anh-num locked">{k === 'otText' && r.team === 'GA' ? '' : fmt(parseAmount(r[k]))}</td>
                );
              return (
                <tr key={r.team}>
                  <td className="font-bold">{t.label}</td>
                  <td>{t.hint}</td>
                  {cell('ctcText', 'cost to company')}
                  {cell('otText', 'overtime')}
                  <td className="anh-num calc">{r.team === 'GA' ? '' : fmt(r.cost)}</td>
                  {data.detail && <td className="anh-num calc">{r.team === 'GA' ? '' : fmt(share[r.team] ?? 0)}</td>}
                </tr>
              );
            })}
            <tr className="total">
              <td colSpan={2}>Total FM staff</td>
              <td className="anh-num">{fmt(sum(rows.map((r) => parseAmount(r.ctcText) ?? 0)))}</td>
              <td className="anh-num">{fmt(sum(rows.map((r) => parseAmount(r.otText) ?? 0)))}</td>
              <td className="anh-num">{fmt(sum(data.staff.map((s) => s.cost)))}</td>
              {data.detail && <td className="anh-num">{fmt(data.detail.compare.find((c) => c.key === 'staff')?.budget ?? 0)}</td>}
            </tr>
          </tbody>
        </table>
      </div>
      {data.unallocated >= 1 && (
        <p className="text-sm">
          <b>Not allocated yet: AED {fmt(data.unallocated)}.</b> Part of the staff cost goes by works of a type that no facility has yet (e.g. supervision of renewal works). It is
          allocated once those lines are entered.
        </p>
      )}
    </section>
  );
}
