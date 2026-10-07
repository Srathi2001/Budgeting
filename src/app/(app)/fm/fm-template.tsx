'use client';

// FM Budget Template: the facilities with last year's budget and actual and this year's budget. A click
// opens the facility's form on the side (as in the Lease Budget): its facts from the tool (locked), the
// budget by work type, and the budgeted costs FMD adds one by one.

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { fmt, MONTHS, sum } from '@/lib/format';
import { StatusBadge } from '@/components/status-badge';
import { BUSINESS_NEEDS, ELEMENTS, FM_KINDS, FM_KIND_LABEL, WORK_TYPE, WORK_TYPES, elementLabel, glOf, type FmKind, type WorkType } from '@/lib/budget/fm-types';
import type { FmFacilityDetail, FmLineRow, FmPageData } from '@/lib/budget/fm-page';
import { fmTransition, saveFmLines } from './actions';
import { FmImport } from './fm-import';

type Msg = { error?: string; ok?: string } | null;
const zoneLabel = (z: string | null) => z?.replace('ZONE_', 'Zone ') ?? '';

export function FmTemplate({ data }: { data: FmPageData }) {
  const router = useRouter();
  const { facilities, detail, version } = data;
  const open = (id: number | null) => router.push(id ? `/fm?f=${id}` : '/fm', { scroll: false });
  const at = detail ? facilities.findIndex((f) => f.id === detail.id) : -1;
  const [importing, setImporting] = useState(false);
  const T = {
    prior: data.priorLabel ? sum(facilities.map((f) => f.prior ?? 0)) : null,
    actual: sum(facilities.map((f) => f.actual)),
    budget: sum(facilities.map((f) => f.budget)),
    lines: sum(facilities.map((f) => f.lines)),
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2">
        <a className="btn" href="/api/export/fm-template" title="Instructions, the facilities in view and their budgeted costs, with blank rows for new costs">
          Download template
        </a>
        {data.canEditStaff && (
          <button className="btn" onClick={() => setImporting((v) => !v)}>
            Import Excel
          </button>
        )}
      </div>
      {importing && <FmImport versionId={version.id} onClose={() => setImporting(false)} />}
      <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-auto p-4">
        <table className="anh-grid">
          <thead>
            <tr className="h1">
              <th>Facility</th>
              <th>BU</th>
              <th>Zone</th>
              {data.priorLabel && <th className="anh-num">{data.priorLabel}</th>}
              <th className="anh-num">{data.actualLabel}</th>
              <th className="anh-num">{version.year}B</th>
              {data.priorLabel && <th className="anh-num">Change</th>}
              <th className="anh-num">Lines</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {facilities.map((f) => (
              <tr key={f.id} onClick={() => open(f.id === detail?.id ? null : f.id)} className="cursor-pointer" aria-selected={f.id === detail?.id}>
                <td className={f.id === detail?.id ? 'font-bold' : undefined}>
                  {f.code} · {f.name}
                </td>
                <td>{f.bu}</td>
                <td>{zoneLabel(f.zone)}</td>
                {data.priorLabel && <td className="anh-num">{fmt(f.prior)}</td>}
                <td className="anh-num">{fmt(f.actual)}</td>
                <td className="anh-num">{fmt(f.budget)}</td>
                {data.priorLabel && <td className="anh-num">{f.lines ? fmt(f.budget - (f.prior ?? 0)) : ''}</td>}
                <td className="anh-num">{f.lines || ''}</td>
                <td>
                  <StatusBadge status={f.status} />
                </td>
              </tr>
            ))}
            <tr className="total">
              <td>Total · {facilities.length} facilities</td>
              <td />
              <td />
              {data.priorLabel && <td className="anh-num">{fmt(T.prior)}</td>}
              <td className="anh-num">{fmt(T.actual)}</td>
              <td className="anh-num">{fmt(T.budget)}</td>
              {data.priorLabel && <td className="anh-num">{fmt(T.budget - (T.prior ?? 0))}</td>}
              <td className="anh-num">{T.lines || ''}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {detail && (
        <FacilityForm
          data={data}
          d={detail}
          onClose={() => open(null)}
          onPrev={at > 0 ? () => open(facilities[at - 1].id) : undefined}
          onNext={at >= 0 && at < facilities.length - 1 ? () => open(facilities[at + 1].id) : undefined}
        />
      )}
      </div>
    </div>
  );
}

// ---- side form ------------------------------------------------------------------------------------

const TONE = { tool: 'var(--control-border)', input: 'var(--ink)', calc: 'var(--line)' } as const;

function Section({ title, tone, note, action, children }: { title: string; tone: keyof typeof TONE; note?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-slate-200 bg-white" style={{ borderLeft: `3px solid ${TONE[tone]}` }}>
      <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-1.5">
        <h3 className="text-[13px] font-bold">{title}</h3>
        {note && <span className="text-[11px]">{note}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

const Lock = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-label="locked">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

function Field({ label, locked, wide, children }: { label: string; locked?: boolean; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`flex min-w-0 flex-col gap-0.5 ${wide ? 'col-span-full' : ''}`}>
      <span className="flex items-center gap-1 text-[11px] font-bold">
        {label}
        {locked && <Lock />}
      </span>
      {children}
    </label>
  );
}

/** a value from the tool: dashed outline, never looks like an input */
const Show = ({ v }: { v: ReactNode }) => <div className="min-h-[1.75rem] rounded-sm border border-dashed border-slate-300 px-2 py-1">{v === null || v === '' ? '—' : v}</div>;

type Entry = { id: number | null; workType: string; element: string; subElement: string; description: string; businessNeed: string; kind: string; month: string; amount: string; remarks: string };
const blank = (): Entry => ({ id: null, workType: '', element: '', subElement: '', description: '', businessNeed: '', kind: 'PLANNED', month: '', amount: '', remarks: '' });
const toEntry = (l: FmLineRow): Entry => ({
  id: l.id,
  workType: l.workType,
  element: l.element,
  subElement: l.subElement ?? '',
  description: l.description ?? '',
  businessNeed: l.businessNeed ?? '',
  kind: l.kind,
  month: l.month ? String(l.month) : '',
  amount: String(l.amount),
  remarks: l.remarks ?? '',
});
const parseAmount = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ''));
  return s.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

function FacilityForm({ data, d, onClose, onPrev, onNext }: { data: FmPageData; d: FmFacilityDetail; onClose: () => void; onPrev?: () => void; onNext?: () => void }) {
  const router = useRouter();
  const { version } = data;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [note, setNote] = useState(d.note ?? '');
  const edit = d.canEdit;
  const age = d.activeSince ? Math.floor((Date.parse(`${version.year}-01-01`) - Date.parse(d.activeSince)) / (365.25 * 864e5)) : null;
  const assets = Object.entries(d.assets ?? {}).sort((a, b) => b[1] - a[1]);
  const priorCol = d.compare.some((c) => c.prior !== null);
  const works = d.compare.filter((c) => c.key !== 'staff');
  const staff = d.compare.find((c) => c.key === 'staff')!;
  const total = (k: 'prior' | 'actual' | 'budget') => sum(d.compare.map((c) => c[k] ?? 0));

  const run = (fn: () => Promise<Msg>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r);
      if (r && !r.error) {
        after?.();
        router.refresh();
      }
    });
  const saveEntry = () => {
    if (!entry) return;
    const amount = parseAmount(entry.amount);
    if (!entry.workType) return setMsg({ error: 'Choose the work type' });
    if (!entry.element) return setMsg({ error: 'Choose the building element' });
    if (amount === null) return setMsg({ error: 'Enter an amount above 0' });
    const spread = WORK_TYPE.get(entry.workType as WorkType)?.spread ?? true;
    const line = {
      id: entry.id,
      workType: entry.workType,
      element: entry.element,
      subElement: entry.subElement || null,
      description: entry.description || null,
      businessNeed: entry.businessNeed || null,
      kind: entry.kind,
      amount,
      month: spread || !entry.month ? null : Number(entry.month),
      remarks: entry.remarks || null,
    };
    run(() => saveFmLines(version.id, d.id, { lines: [line], deleted: [] }), () => setEntry(null));
  };
  const remove = (l: FmLineRow) => {
    if (!confirm(`Remove ${l.workType} ${l.description ?? elementLabel(l.element)} (${fmt(l.amount)})?`)) return;
    run(() => saveFmLines(version.id, d.id, { lines: [], deleted: [l.id] }));
  };
  const transition = (action: 'submit' | 'approve' | 'return') => {
    if (action === 'submit' && entry) return setMsg({ error: 'Save or cancel the cost being entered first' });
    run(() => fmTransition(version.id, d.id, action, note));
  };
  const leave = (fn?: () => void) => () => {
    if (!fn) return;
    if (entry && !confirm('Discard the cost being entered?')) return;
    fn();
  };
  const set = (patch: Partial<Entry>) => setEntry((e) => (e ? { ...e, ...patch } : e));
  const entrySpread = entry ? (WORK_TYPE.get(entry.workType as WorkType)?.spread ?? true) : true;

  return (
    <aside aria-label="Facility form" className="lease-form flex h-full min-h-0 w-1/2 shrink-0 flex-col border-l-2 border-sky-700 bg-slate-50 text-[13px]">
      <div className="flex items-start gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">
            {d.code} · {d.name}
          </div>
          <div className="flex items-center gap-2 text-xs">
            {d.bu} {d.buName} · {zoneLabel(d.zone) || 'No FM zone'} <StatusBadge status={d.status} />
            {!edit && d.reason && <span>· {d.reason}</span>}
          </div>
          <div className="mt-1 flex items-center gap-3 text-[11px]" aria-label="Field legend">
            <span className="flex items-center gap-1">
              <i className="swatch input" /> To enter
            </span>
            <span className="flex items-center gap-1">
              <i className="swatch locked" /> From the tool, locked
            </span>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button className="btn btn-xs" disabled={!onPrev} onClick={leave(onPrev)} title="Previous facility">
            ↑
          </button>
          <button className="btn btn-xs" disabled={!onNext} onClick={leave(onNext)} title="Next facility">
            ↓
          </button>
          <button className="btn btn-xs" onClick={leave(onClose)}>
            Close
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {msg && <div className={`text-sm ${msg.error ? 'text-red-600' : ''}`}>{msg.error ?? msg.ok}</div>}

        <Section title="Details" tone="tool" note="Facility master, Lease Budget and FMD file">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 2xl:grid-cols-3">
            <Field label="Business unit" locked>
              <Show v={`${d.bu} ${d.buName}`} />
            </Field>
            <Field label="Property manager" locked>
              <Show v={d.pm} />
            </Field>
            <Field label="FM zone" locked>
              <Show v={zoneLabel(d.zone)} />
            </Field>
            <Field label="In service since" locked>
              <Show v={d.activeSince ? `${d.activeSince.slice(0, 4)}${age !== null ? ` · ${age} years` : ''}` : null} />
            </Field>
            <Field label="Gross area, sq ft" locked>
              <Show v={d.grossArea ? fmt(d.grossArea) : null} />
            </Field>
            <Field label="Lettable area, sq ft" locked>
              <Show v={d.lettableArea ? fmt(d.lettableArea) : null} />
            </Field>
            <Field label="Units" locked>
              <Show v={String(d.units)} />
            </Field>
            <Field label="Leased now" locked>
              <Show v={String(d.leased)} />
            </Field>
            <Field label="Vacant now" locked>
              <Show v={String(d.vacant)} />
            </Field>
            <Field label={`Moving out in ${version.year}`} locked>
              <Show v={String(d.moveOuts)} />
            </Field>
            <Field label={`Rental revenue ${version.year}B`} locked>
              <Show v={fmt(d.revenue)} />
            </Field>
            {d.priorRevenue !== null && (
              <Field label={`Rental revenue ${version.year - 1}B`} locked>
                <Show v={fmt(d.priorRevenue)} />
              </Field>
            )}
            {assets.length > 0 && (
              <Field label="HVAC assets" locked wide>
                <Show v={assets.map(([k, n]) => `${k} ${n}`).join(' · ')} />
              </Field>
            )}
          </div>
        </Section>

        <Section title="Budget by work type" tone="calc">
          <table className="anh-grid w-full">
            <thead>
              <tr className="h1">
                <th>Work type</th>
                {priorCol && <th className="anh-num">{data.priorLabel}</th>}
                <th className="anh-num">{data.actualLabel}</th>
                <th className="anh-num">{version.year}B</th>
              </tr>
            </thead>
            <tbody>
              {works.map((c) => (
                <tr key={c.key}>
                  <td>
                    {c.key !== 'other' && <span className="anh-code mr-2">{c.key}</span>}
                    {c.label}
                  </td>
                  {priorCol && <td className="anh-num locked">{fmt(c.prior)}</td>}
                  <td className="anh-num locked">{fmt(c.actual)}</td>
                  <td className="anh-num calc">{fmt(c.budget)}</td>
                </tr>
              ))}
              <tr className="subtotal">
                <td>{staff.label}</td>
                {priorCol && <td className="anh-num">{fmt(staff.prior)}</td>}
                <td />
                <td className="anh-num">{fmt(staff.budget)}</td>
              </tr>
              <tr className="total">
                <td>Total</td>
                {priorCol && <td className="anh-num">{fmt(total('prior'))}</td>}
                <td className="anh-num">{fmt(total('actual'))}</td>
                <td className="anh-num">{fmt(total('budget'))}</td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Section
          title={`Budgeted costs · ${version.year}B`}
          tone="input"
          note={`${d.lines.length} line${d.lines.length === 1 ? '' : 's'}`}
          action={
            edit &&
            !entry && (
              <button className="btn-primary btn-xs" onClick={() => setEntry(blank())} disabled={pending}>
                + Add cost
              </button>
            )
          }
        >
          {entry && (
            <div className="mb-3 border border-slate-300 p-3">
              <div className="mb-2 text-[13px] font-bold">{entry.id ? 'Edit cost' : 'New cost'}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 2xl:grid-cols-3">
                <Field label="Work type">
                  <select className="input" value={entry.workType} onChange={(e) => set({ workType: e.target.value, month: WORK_TYPE.get(e.target.value as WorkType)?.spread ? '' : entry.month })}>
                    <option value="">Choose…</option>
                    {WORK_TYPES.map((w) => (
                      <option key={w.code} value={w.code}>
                        {w.code} {w.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Element · GL">
                  <select className="input" value={entry.element} onChange={(e) => set({ element: e.target.value })}>
                    <option value="">Choose…</option>
                    {ELEMENTS.map((e) => (
                      <option key={e.code} value={e.code}>
                        {glOf(entry.workType, e.code)} {e.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Sub-element">
                  <input className="input" value={entry.subElement} onChange={(e) => set({ subElement: e.target.value })} />
                </Field>
                <Field label="Description of works" wide>
                  <textarea className="input min-h-[3.5rem]" value={entry.description} onChange={(e) => set({ description: e.target.value })} />
                </Field>
                <Field label="Business need">
                  <select className="input" value={entry.businessNeed} onChange={(e) => set({ businessNeed: e.target.value })}>
                    <option value="">Choose…</option>
                    {BUSINESS_NEEDS.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Type">
                  <select className="input" value={entry.kind} onChange={(e) => set({ kind: e.target.value })} title={FM_KINDS.find((k) => k.code === entry.kind)?.hint}>
                    {FM_KINDS.map((k) => (
                      <option key={k.code} value={k.code}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Month">
                  {entrySpread ? (
                    <Show v={entry.workType ? 'Jan–Dec (spread over the year)' : '—'} />
                  ) : (
                    <select className="input" value={entry.month} onChange={(e) => set({ month: e.target.value })}>
                      <option value="">Jan–Dec (spread)</option>
                      {MONTHS.map((m, i) => (
                        <option key={m} value={String(i + 1)}>
                          {m}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Amount, AED">
                  <input className="input text-right tabular-nums" inputMode="decimal" value={entry.amount} onChange={(e) => set({ amount: e.target.value })} />
                </Field>
                <Field label="Remarks" wide>
                  <input className="input" value={entry.remarks} onChange={(e) => set({ remarks: e.target.value })} />
                </Field>
              </div>
              <div className="mt-3 flex gap-2">
                <button className="btn-primary" onClick={saveEntry} disabled={pending}>
                  {pending ? 'Saving…' : entry.id ? 'Save' : 'Add'}
                </button>
                <button className="btn" onClick={() => setEntry(null)} disabled={pending}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {d.lines.length === 0 ? (
            !entry && <div>No costs entered yet.</div>
          ) : (
            <table className="anh-grid w-full">
              <thead>
                <tr className="h1">
                  <th>Work type</th>
                  <th>Element · GL</th>
                  <th>Description of works</th>
                  <th>Type</th>
                  <th>Month</th>
                  <th className="anh-num">Amount</th>
                  {edit && <th />}
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.id} title={[l.subElement, l.businessNeed, l.remarks].filter(Boolean).join(' · ') || undefined}>
                    <td>{l.workType}</td>
                    <td>
                      {glOf(l.workType, l.element)} {elementLabel(l.element)}
                    </td>
                    <td>{l.description ?? l.subElement ?? ''}</td>
                    <td>{FM_KIND_LABEL[l.kind as FmKind] ?? l.kind}</td>
                    <td>{l.month ? MONTHS[l.month - 1] : 'Jan–Dec'}</td>
                    <td className="anh-num">{fmt(l.amount)}</td>
                    {edit && (
                      <td className="whitespace-nowrap">
                        <button className="btn btn-xs" onClick={() => setEntry(toEntry(l))} disabled={pending || !!entry}>
                          Edit
                        </button>{' '}
                        {l.source === 'FM' && (
                          <button className="btn btn-xs" onClick={() => remove(l)} disabled={pending || !!entry}>
                            Remove
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={5}>Total</td>
                  <td className="anh-num">{fmt(sum(d.lines.map((l) => l.amount)))}</td>
                  {edit && <td />}
                </tr>
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Approval" tone="input">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={d.status} />
            <input className="input min-w-[12rem] flex-1" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} disabled={version.locked} />
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
        </Section>
      </div>
    </aside>
  );
}
