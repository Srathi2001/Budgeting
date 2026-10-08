'use client';

// One back-up schedule of the admin overheads (vehicles, telephones, training plan, staff welfare, IT
// equipment, office capex, other items), as the sheets of the 2026 department templates: the items in a
// list, and a click opens the item's form on the side (as in the Lease Budget). Each item shows what it
// posts to the GL accounts; the Overview takes the totals.

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { fmt, MONTHS } from '@/lib/format';
import { ADMIN_ACCOUNT, ADMIN_ACCOUNTS, DEPTS, PAYERS, deptName } from '@/lib/budget/admin-types';
import { CAPEX, ITEM_KIND, SCHEDULE_ACCOUNT, itemTotal, type AdminItem, type FieldSpec, type ItemData, type ItemKind } from '@/lib/budget/admin-items';
import { deleteAdminItemAction, saveAdminItemAction } from './actions';

type Msg = { error?: string; ok?: string } | null;
type Draft = { id: number | null; dept: string; payer: string; values: Record<string, string>; pax: Record<string, string> };

const BUDGET_DEPTS = DEPTS.filter((d) => !d.elsewhere);
// other items post to the accounts without a schedule of their own
const OH_ACCOUNTS = ADMIN_ACCOUNTS.filter((a) => a.group !== 'Payroll' && !SCHEDULE_ACCOUNT.has(a.code));
const payerName = (code: string) => PAYERS.find((p) => p.code === code)?.name ?? code;
const accountName = (code: string) => (code === CAPEX ? 'Office & IT capex (cash only)' : `${code} ${ADMIN_ACCOUNT.get(code)?.name ?? ''}`);

const toDraft = (it: AdminItem | null, kind: ItemKind, dept: string): Draft => {
  const spec = ITEM_KIND.get(kind)!;
  const values: Record<string, string> = {};
  let pax: Record<string, string> = {};
  for (const f of spec.fields) {
    const v = it?.data[f.key];
    if (f.type === 'paxByDept') pax = Object.fromEntries(Object.entries((v as Record<string, number> | null) ?? {}).map(([d, p]) => [d, String(p)]));
    else values[f.key] = v === null || v === undefined ? '' : String(v);
  }
  return { id: it?.id ?? null, dept: it?.dept ?? dept, payer: it?.payer ?? '521', values, pax };
};

/** the draft as item data (numbers where the field is numeric); bad numbers stay as text for the server to refuse */
const toData = (kind: ItemKind, d: Draft): ItemData => {
  const out: ItemData = {};
  for (const f of ITEM_KIND.get(kind)!.fields) {
    if (f.type === 'paxByDept') {
      out[f.key] = Object.fromEntries(
        Object.entries(d.pax)
          .filter(([, p]) => p.trim() !== '')
          .map(([dept, p]) => [dept, Number(p)]),
      );
      continue;
    }
    const s = (d.values[f.key] ?? '').trim();
    if (s === '') out[f.key] = null;
    else if (f.type === 'amount' || f.type === 'int' || f.type === 'month') {
      const x = Number(s.replace(/[,\s]/g, ''));
      out[f.key] = Number.isFinite(x) ? x : s;
    } else out[f.key] = s;
  }
  return out;
};

const shown = (f: FieldSpec | undefined, v: unknown) => {
  if (v === null || v === undefined || v === '') return '';
  if (!f) return String(v);
  if (f.type === 'month') return MONTHS[Number(v) - 1] ?? '';
  if (f.type === 'account') return accountName(String(v));
  if (f.type === 'amount') return fmt(Number(v));
  return String(v);
};

export function AdminSchedule({ kind, items, versionId, year, locked }: { kind: ItemKind; items: AdminItem[]; versionId: number; year: number; locked: boolean }) {
  const router = useRouter();
  const spec = ITEM_KIND.get(kind)!;
  const [deptFilter, setDeptFilter] = useState('');
  const [open, setOpen] = useState<number | 'new' | null>(null);
  const view = useMemo(
    () => items.filter((it) => !deptFilter || it.dept === deptFilter || spec.postings(it.data, it.dept).some((p) => p.dept === deptFilter)),
    [items, deptFilter, spec],
  );
  const amountCols = spec.fields.filter((f) => f.type === 'amount' && f.account);
  const at = typeof open === 'number' ? view.findIndex((i) => i.id === open) : -1;
  const current = typeof open === 'number' ? (items.find((i) => i.id === open) ?? null) : null;
  const total = view.reduce((s, it) => s + itemTotal(it), 0);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-auto p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <p className="text-xs text-slate-500">
            {spec.label} · replaces the 2026 template sheet “{spec.sheet}” · {year}B · posts to{' '}
            {[...new Set(spec.fields.filter((f) => f.account).map((f) => f.account!))].join(', ') || (kind === 'training' ? '63602 by attendee department' : kind === 'event' ? '63601' : kind === 'other' ? 'the account chosen' : 'office & IT capex')}
          </p>
          <select aria-label="Department" className="input ml-auto w-56" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="">All departments</option>
            {BUDGET_DEPTS.map((d) => (
              <option key={d.code} value={d.code}>
                {d.code} {d.name}
              </option>
            ))}
          </select>
          {!locked && (
            <button className="btn-primary" onClick={() => setOpen('new')}>
              Add {spec.one}
            </button>
          )}
        </div>
        <table className="anh-grid">
          <thead>
            <tr className="h1">
              <th>Department</th>
              {spec.columns.map((c) => (
                <th key={c}>{spec.fields.find((f) => f.key === c)?.label ?? c}</th>
              ))}
              {kind === 'training' && <th className="anh-num">Attendees</th>}
              {amountCols.map((f) => (
                <th key={f.key} className="anh-num">
                  {f.label}
                </th>
              ))}
              <th>Paid by</th>
              <th className="anh-num">Year total</th>
            </tr>
          </thead>
          <tbody>
            {view.map((it) => (
              <tr key={it.id} onClick={() => setOpen(it.id === open ? null : it.id)} className="cursor-pointer" aria-selected={it.id === open}>
                <td className={it.id === open ? 'font-bold' : undefined}>{deptName(it.dept)}</td>
                {spec.columns.map((c) => (
                  <td key={c}>{shown(spec.fields.find((f) => f.key === c), it.data[c])}</td>
                ))}
                {kind === 'training' && <td className="anh-num">{Object.values((it.data.pax as Record<string, number>) ?? {}).reduce((s, p) => s + p, 0)}</td>}
                {amountCols.map((f) => (
                  <td key={f.key} className="anh-num">
                    {fmt((it.data[f.key] as number | null) ?? null)}
                  </td>
                ))}
                <td>{payerName(it.payer)}</td>
                <td className="anh-num font-semibold">{fmt(itemTotal(it))}</td>
              </tr>
            ))}
            {view.length === 0 && (
              <tr>
                <td colSpan={spec.columns.length + amountCols.length + 4} className="is-empty">
                  No {spec.label.toLowerCase()} yet{locked ? '' : `: Add ${spec.one}`}
                </td>
              </tr>
            )}
            {view.length > 0 && (
              <tr className="total">
                <td>
                  Total · {view.length} {view.length === 1 ? spec.one : spec.label.toLowerCase()}
                </td>
                {spec.columns.map((c) => (
                  <td key={c} />
                ))}
                {kind === 'training' && <td />}
                {amountCols.map((f) => (
                  <td key={f.key} className="anh-num">
                    {fmt(view.reduce((s, it) => s + ((it.data[f.key] as number | null) ?? 0), 0))}
                  </td>
                ))}
                <td />
                <td className="anh-num">{fmt(total)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {open !== null && (
        <ItemForm
          // a new item reopens with its saved values once the page data has refreshed
          key={`${open}-${current ? 'saved' : 'draft'}`}
          kind={kind}
          item={current}
          defaultDept={deptFilter || BUDGET_DEPTS[0].code}
          versionId={versionId}
          locked={locked}
          onClose={() => setOpen(null)}
          onSaved={(id) => {
            setOpen(id);
            router.refresh();
          }}
          onDeleted={() => {
            setOpen(null);
            router.refresh();
          }}
          onPrev={at > 0 ? () => setOpen(view[at - 1].id) : undefined}
          onNext={at >= 0 && at < view.length - 1 ? () => setOpen(view[at + 1].id) : undefined}
        />
      )}
    </div>
  );
}

// ---- side form ------------------------------------------------------------------------------------

const TONE = { input: 'var(--ink)', calc: 'var(--line)' } as const;

function Section({ title, tone, note, children }: { title: string; tone: keyof typeof TONE; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-slate-200 bg-white" style={{ borderLeft: `3px solid ${TONE[tone]}` }}>
      <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-1.5">
        <h3 className="text-[13px] font-bold">{title}</h3>
        {note && <span className="text-[11px]">{note}</span>}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`flex min-w-0 flex-col gap-0.5 ${wide ? 'col-span-full' : ''}`}>
      <span className="text-[11px] font-bold">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-slate-500">{hint}</span>}
    </label>
  );
}

function ItemForm({
  kind,
  item,
  defaultDept,
  versionId,
  locked,
  onClose,
  onSaved,
  onDeleted,
  onPrev,
  onNext,
}: {
  kind: ItemKind;
  item: AdminItem | null;
  defaultDept: string;
  versionId: number;
  locked: boolean;
  onClose: () => void;
  onSaved: (id: number) => void;
  onDeleted: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const spec = ITEM_KIND.get(kind)!;
  const [draft, setDraft] = useState<Draft>(() => toDraft(item, kind, defaultDept));
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const initial = useMemo(() => JSON.stringify(toDraft(item, kind, defaultDept)), [item, kind, defaultDept]);
  const dirty = JSON.stringify(draft) !== initial;
  const data = toData(kind, draft);
  const postings = spec.postings(data, draft.dept).filter((p) => p.amount > 0);
  const set = (key: string, v: string) => setDraft((d) => ({ ...d, values: { ...d.values, [key]: v } }));
  const leave = (fn?: () => void) => () => {
    if (!fn) return;
    if (dirty && !confirm('Discard the changes?')) return;
    fn();
  };
  const save = () =>
    start(async () => {
      const r = await saveAdminItemAction(versionId, { id: draft.id, kind, dept: draft.dept, payer: draft.payer, data });
      if (r.error) setMsg({ error: r.error });
      else {
        setMsg({ ok: 'Saved' });
        onSaved(r.id!);
      }
    });
  const remove = () => {
    if (!draft.id || !confirm(`Remove this ${spec.one}?`)) return;
    start(async () => {
      const r = await deleteAdminItemAction(versionId, draft.id!);
      if (r.error) setMsg({ error: r.error });
      else onDeleted();
    });
  };
  const title = item ? String(item.data[spec.columns[0]] ?? spec.one) : `New ${spec.one}`;

  const input = (f: FieldSpec) => {
    const v = draft.values[f.key] ?? '';
    const common = { disabled: locked, 'aria-label': f.label };
    switch (f.type) {
      case 'select':
        return (
          <select className="input" value={v} onChange={(e) => set(f.key, e.target.value)} {...common}>
            <option value="">Choose…</option>
            {f.options!.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      case 'month':
        return (
          <select className="input" value={v} onChange={(e) => set(f.key, e.target.value)} {...common}>
            <option value="">Evenly over the year</option>
            {MONTHS.map((mo, i) => (
              <option key={mo} value={i + 1}>
                {mo}
              </option>
            ))}
          </select>
        );
      case 'account':
        return (
          <select className="input" value={v} onChange={(e) => set(f.key, e.target.value)} {...common}>
            <option value="">Choose…</option>
            {OH_ACCOUNTS.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} {a.name} · {a.group}
              </option>
            ))}
          </select>
        );
      case 'amount':
      case 'int':
        return <input className="input text-right tabular-nums" inputMode="decimal" value={v} onChange={(e) => set(f.key, e.target.value)} {...common} />;
      case 'paxByDept':
        return (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 2xl:grid-cols-3">
            {BUDGET_DEPTS.map((d) => (
              <label key={d.code} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{d.name}</span>
                <input
                  className="input w-16 text-right tabular-nums"
                  inputMode="numeric"
                  disabled={locked}
                  aria-label={`${d.name} attendees`}
                  value={draft.pax[d.code] ?? ''}
                  onChange={(e) => setDraft((x) => ({ ...x, pax: { ...x.pax, [d.code]: e.target.value } }))}
                />
              </label>
            ))}
          </div>
        );
      default:
        return <input className="input" value={v} onChange={(e) => set(f.key, e.target.value)} {...common} />;
    }
  };

  return (
    <aside aria-label={`${spec.one} form`} className="lease-form flex h-full min-h-0 w-1/2 shrink-0 flex-col border-l-2 border-sky-700 bg-slate-50 text-[13px]">
      <div className="flex items-start gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{title}</div>
          <div className="text-xs">
            {spec.label} · {deptName(draft.dept)} · paid by {payerName(draft.payer)}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button className="btn btn-xs" disabled={!onPrev} onClick={leave(onPrev)} title={`Previous ${spec.one}`}>
            ↑
          </button>
          <button className="btn btn-xs" disabled={!onNext} onClick={leave(onNext)} title={`Next ${spec.one}`}>
            ↓
          </button>
          <button className="btn btn-xs" onClick={leave(onClose)}>
            Close
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {msg && <div className={`text-sm ${msg.error ? 'text-red-600' : ''}`}>{msg.error ?? msg.ok}</div>}

        <Section title="Department" tone="input" note={kind === 'training' ? 'the department that owns the plan (HR); each attendee department is charged' : undefined}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <Field label="Department">
              <select className="input" value={draft.dept} disabled={locked} onChange={(e) => setDraft((d) => ({ ...d, dept: e.target.value }))}>
                {BUDGET_DEPTS.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code} {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Paid by">
              <select className="input" value={draft.payer} disabled={locked} onChange={(e) => setDraft((d) => ({ ...d, payer: e.target.value }))}>
                {PAYERS.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section title={spec.label} tone="input" note={`as the 2026 sheet “${spec.sheet}”`}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 2xl:grid-cols-3">
            {spec.fields.map((f) => (
              <Field key={f.key} label={`${f.label}${f.required ? '' : ' (optional)'}`} hint={f.account ? `${f.hint ? `${f.hint} · ` : ''}GL ${f.account}` : f.hint} wide={f.wide}>
                {input(f)}
              </Field>
            ))}
          </div>
        </Section>

        <Section title="Posts to" tone="calc" note="what the Overview and the P&L take">
          {postings.length ? (
            <table className="anh-grid">
              <thead>
                <tr className="h1">
                  <th>Department</th>
                  <th>Account</th>
                  <th>When</th>
                  <th className="anh-num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {postings.map((p, i) => (
                  <tr key={i}>
                    <td>{deptName(p.dept)}</td>
                    <td>{accountName(p.account)}</td>
                    <td>{p.month ? MONTHS[p.month - 1] : 'Monthly'}</td>
                    <td className="anh-num">{fmt(p.amount)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td>Total</td>
                  <td />
                  <td />
                  <td className="anh-num">{fmt(postings.reduce((s, p) => s + p.amount, 0))}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="text-xs text-slate-500">Nothing yet: enter the amounts.</div>
          )}
        </Section>
      </div>

      {!locked && (
        <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-4 py-2">
          <button className="btn-primary" disabled={pending || !dirty} onClick={save}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button className="btn" disabled={pending || !dirty} onClick={() => setDraft(JSON.parse(initial))}>
            Cancel
          </button>
          {draft.id && (
            <button className="btn ml-auto" disabled={pending} onClick={remove}>
              Remove
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
