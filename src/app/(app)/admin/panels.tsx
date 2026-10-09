'use client';

import { useState, useTransition } from 'react';
import type { Assumptions } from '@/lib/engine/assumptions';
import { count, fmt, fmtDateTime } from '@/lib/format';
import { StatusBadge } from '@/components/status-badge';
import {
  setVersionStatus,
  createNextVersion,
  recalcVersion,
  saveAssumptions,
  upsertUser,
  updateProperty,
  importComparatives,
  previewLeaseImport,
  applyLeaseImport,
  applyGlActuals,
  previewRevenueImport,
  applyRevenueImportAction,
} from './actions';
import type { RrPreview } from '@/lib/import/revenue-recognition';
import type { ImportPreview } from '@/lib/import/tenant-lease';
import type { GlLedger, GlPreview, GlValue } from '@/lib/import/gl-other-income';
import type { FmActual, FmActualsPreview } from '@/lib/import/gl-fm';
import type { BohActual, BohActualsPreview } from '@/lib/import/gl-boh';
import type { AdminActual, AdminActualsPreview } from '@/lib/import/gl-admin';
import { locationOf } from '@/lib/budget/location';
import { saveComparative } from '../analysis/actions';

type Result = { error?: string; ok?: string };

function useAction() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Result | null>(null);
  const run = (fn: () => Promise<Result>) => start(async () => setMsg(await fn()));
  const Msg = () =>
    msg ? <span className={`text-sm ${msg.error ? 'text-red-600' : 'text-emerald-700'}`}>{msg.error ?? msg.ok}</span> : null;
  return { pending, run, Msg };
}

const n = (v: FormDataEntryValue | null) => Number(String(v ?? '').replace(/,/g, ''));

// ---- versions -------------------------------------------------------------------------------

export function VersionsPanel({
  versions,
}: {
  versions: { id: number; name: string; year: number; status: 'OPEN' | 'LOCKED'; isBaseline: boolean; createdAt: string }[];
}) {
  const { pending, run, Msg } = useAction();
  return (
    <div className="space-y-4">
      <div className="frame">
        <table className="tbl">
          <thead>
            <tr>
              <th>Version</th>
              <th>Year</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td>
                  {v.name}
                  {v.isBaseline && <span className="ml-2 text-xs text-slate-500">(imported baseline)</span>}
                </td>
                <td>{v.year}</td>
                <td>
                  <StatusBadge status={v.status} />
                </td>
                <td className="text-xs text-slate-500">{v.createdAt.slice(0, 10)}</td>
                <td className="flex gap-1">
                  {v.status === 'OPEN' ? (
                    <button className="btn" disabled={pending} onClick={() => confirm(`Lock ${v.name}? Nobody will be able to edit it.`) && run(() => setVersionStatus(v.id, 'LOCKED'))}>
                      Lock
                    </button>
                  ) : (
                    <button className="btn" disabled={pending} onClick={() => run(() => setVersionStatus(v.id, 'OPEN'))}>
                      Reopen
                    </button>
                  )}
                  <button className="btn" disabled={pending} onClick={() => run(() => recalcVersion(v.id))}>
                    Recalculate
                  </button>
                  <button
                    className="btn"
                    disabled={pending}
                    onClick={() => {
                      const name = prompt(`Name for the ${v.year + 1} version created from "${v.name}"`, `${v.year + 1} Budget`);
                      if (name) run(() => createNextVersion(v.id, name));
                    }}
                  >
                    Roll forward to {v.year + 1}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-slate-600">
        <b>Roll forward</b> creates next year&apos;s version. For every unit, the contract in force on 1 January becomes the current contract.
        Renewals are then derived again from the RERA index and budget rates. RERA index rows and manual other income are copied, and
        this version&apos;s revenue becomes a comparative in Revenue Analysis.
      </p>
      {pending ? <span className="text-sm text-slate-500">Working…</span> : <Msg />}
    </div>
  );
}

// ---- assumptions ----------------------------------------------------------------------------

export function AssumptionsPanel({
  versionId,
  versionName,
  locked,
  assumptions: a,
}: {
  versionId: number;
  versionName: string;
  locked: boolean;
  assumptions: Assumptions;
}) {
  const { pending, run, Msg } = useAction();
  const [bands, setBands] = useState(a.reraBands);
  const field = (name: keyof Assumptions, label: string, value: number, hint: string, scale = 1, unit = '') => (
    <label className="grid grid-cols-[16rem_8rem_1fr] items-center gap-3 py-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <span className="flex items-center gap-1">
        <input name={name} defaultValue={Math.round(value * scale * 10000) / 10000} disabled={locked} className="cell-edit text-right" />
        <span className="text-slate-500">{unit}</span>
      </span>
      <span className="text-xs text-slate-500">{hint}</span>
    </label>
  );
  return (
    <form
      className="card space-y-1 p-4"
      action={(f) =>
        run(() =>
          saveAssumptions(versionId, {
            renewalTermDays: n(f.get('renewalTermDays')),
            staffDiscount: n(f.get('staffDiscount')) / 100,
            reraBands: bands,
            labourIncrease: n(f.get('labourIncrease')) / 100,
            campIncrease: n(f.get('campIncrease')) / 100,
            defaultCheques: n(f.get('defaultCheques')),
            chequeSpanDays: n(f.get('chequeSpanDays')),
            vatRate: n(f.get('vatRate')) / 100,
            depositPct: n(f.get('depositPct')) / 100,
            mfPct: n(f.get('mfPct')) / 100,
          }),
        )
      }
    >
      <h2 className="mb-2 font-semibold">Assumptions · {versionName}</h2>
      {field('renewalTermDays', 'Renewal term', a.renewalTermDays, 'Length of a renewed / new contract', 1, 'days')}
      {field('staffDiscount', 'Staff discount', a.staffDiscount, 'Grossed up when comparing staff rents with RERA', 100, '%')}
      {field('labourIncrease', 'Labour unit renewal increase', a.labourIncrease, 'R/C = L units outside the camps', 100, '%')}
      {field('campIncrease', 'Labour camp renewal increase', a.campIncrease, 'Camps (rate per bed)', 100, '%')}
      {field('defaultCheques', 'Cheques per contract', a.defaultCheques, 'Default when a unit has no cheque count', 1, '')}
      {field('chequeSpanDays', 'Cheque schedule span', a.chequeSpanDays, 'Cheque interval = span ÷ cheques (template: 370 ÷ 4 = 92.5 days)', 1, 'days')}
      {field('vatRate', 'VAT', a.vatRate, 'On commercial & labour rent; residential rent exempt. Included in cash inflow', 100, '%')}
      {field('depositPct', 'Security deposit', a.depositPct, 'Of annual rent: received from new tenants, refunded when a tenant leaves', 100, '%')}
      {field('mfPct', 'Maintenance service fee', a.mfPct, 'Of the renewal / new-tenant rent, residential leases with MF: other income, in the month the contract starts', 100, '%')}

      <div className="pt-3">
        <div className="text-sm font-medium text-slate-700">RERA increase bands</div>
        <p className="mb-2 text-xs text-slate-500">If the current rent is more than X% below the RERA average, the renewal increase is Y%.</p>
        <table className="tbl tbl-fit">
          <thead>
            <tr>
              <th className="num">Rent below RERA avg by more than</th>
              <th className="num">Increase</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bands.map((b, i) => (
              <tr key={i}>
                <td className="num">
                  <input
                    className="cell-edit w-16 text-right"
                    disabled={locked}
                    value={Math.round(b.gapAbove * 10000) / 100}
                    onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, gapAbove: Number(e.target.value) / 100 } : x)))}
                  />{' '}
                  %
                </td>
                <td className="num">
                  <input
                    className="cell-edit w-16 text-right"
                    disabled={locked}
                    value={Math.round(b.increase * 10000) / 100}
                    onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, increase: Number(e.target.value) / 100 } : x)))}
                  />{' '}
                  %
                </td>
                <td>
                  {!locked && (
                    <button type="button" className="text-xs text-red-600" onClick={() => setBands(bands.filter((_, j) => j !== i))}>
                      remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!locked && (
          <button type="button" className="btn mt-2" onClick={() => setBands([...bands, { gapAbove: 0, increase: 0 }])}>
            + Band
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 pt-4">
        {!locked && (
          <button className="btn-primary" disabled={pending}>
            {pending ? 'Recalculating…' : 'Save & recalculate'}
          </button>
        )}
        <Msg />
      </div>
    </form>
  );
}

// ---- properties -------------------------------------------------------------------------------

type PropRow = { id: number; code: string; name: string; buCode: string; coordinator: string | null; kind: 'BUILDING' | 'CAMP' | 'MALL'; location: string | null; active: boolean };

export function PropertiesPanel({ rows }: { rows: PropRow[] }) {
  const { pending, run, Msg } = useAction();
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        The coordinator (PC) decides which property manager can edit a property. Camps are priced per bed per month. Location groups
        properties for rent per sq ft by area; left blank, it is recognised from the property name (shown in grey).
      </p>
      <Msg />
      <div className="frame">
        <table className="tbl">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>BU</th>
              <th>Coordinator</th>
              <th>Location</th>
              <th>Kind</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td colSpan={8} className="p-0">
                  <form
                    className="grid grid-cols-[7rem_1fr_4rem_9rem_11rem_8rem_5rem_5rem] items-center gap-2 px-2 py-1"
                    action={(f) =>
                      run(() =>
                        updateProperty(p.id, {
                          name: String(f.get('name')),
                          coordinator: (f.get('coordinator') as string) || null,
                          kind: f.get('kind') as PropRow['kind'],
                          location: (f.get('location') as string) || null,
                          active: f.get('active') === 'on',
                        }),
                      )
                    }
                  >
                    <span className="text-slate-600">{p.code}</span>
                    <input name="name" defaultValue={p.name} className="input" />
                    <span>{p.buCode}</span>
                    <input name="coordinator" defaultValue={p.coordinator ?? ''} className="input" />
                    <input name="location" defaultValue={p.location ?? ''} placeholder={locationOf({ name: p.name, location: null })} className="input" />
                    <select name="kind" defaultValue={p.kind} className="input">
                      <option>BUILDING</option>
                      <option>CAMP</option>
                      <option>MALL</option>
                    </select>
                    <input type="checkbox" name="active" defaultChecked={p.active} />
                    <button className="btn" disabled={pending}>
                      Save
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- users ------------------------------------------------------------------------------------

type UserRow = { id: number; email: string; name: string; role: 'ADMIN' | 'FINANCE' | 'PM' | 'FM'; coordinator: string | null; active: boolean };

export function UsersPanel({ rows, isAdmin }: { rows: UserRow[]; isAdmin: boolean }) {
  const { pending, run, Msg } = useAction();
  const submit = (id: number | null) => (f: FormData) =>
    run(() =>
      upsertUser(id, {
        email: String(f.get('email') ?? ''),
        name: String(f.get('name') ?? ''),
        role: f.get('role') as UserRow['role'],
        coordinator: (f.get('coordinator') as string) || null,
        password: (f.get('password') as string) || null,
        active: f.get('active') === 'on',
      }),
    );
  const fields = (u?: UserRow) => (
    <>
      <input name="name" defaultValue={u?.name} placeholder="Name" required className="input" />
      <input name="email" defaultValue={u?.email} placeholder="Email" required className="input" />
      <select name="role" defaultValue={u?.role ?? 'PM'} className="input">
        {isAdmin && <option>ADMIN</option>}
        <option>FINANCE</option>
        <option>PM</option>
        <option value="FM">FM (facilities management)</option>
      </select>
      <input name="coordinator" defaultValue={u?.coordinator ?? ''} placeholder="PC code (PMs)" className="input" />
      <input name="password" type="password" placeholder={u ? 'New password (optional)' : 'Password'} className="input" autoComplete="new-password" />
      <label className="flex items-center gap-1 text-sm">
        <input type="checkbox" name="active" defaultChecked={u?.active ?? true} /> Active
      </label>
    </>
  );
  const grid = 'grid grid-cols-[1fr_1.4fr_7rem_8rem_1fr_5rem_5rem] items-center gap-2';
  return (
    <div className="space-y-3">
      <Msg />
      <div className="card space-y-1 p-3">
        <div className={`${grid} px-1 text-xs font-semibold text-slate-600`}>
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span>Coordinator</span>
          <span>Password</span>
          <span />
          <span />
        </div>
        {rows.map((u) => (
          <form key={u.id} action={submit(u.id)} className={grid}>
            {fields(u)}
            <button className="btn" disabled={pending}>
              Save
            </button>
          </form>
        ))}
        <form action={submit(null)} className={`${grid} border-t border-slate-200 pt-2`}>
          {fields()}
          <button className="btn-primary" disabled={pending}>
            Add user
          </button>
        </form>
      </div>
    </div>
  );
}

// ---- comparatives -----------------------------------------------------------------------------

type CompRow = {
  id: number;
  code: string;
  name: string;
  bu: string;
  values: Record<string, number | null>;
  /** 'actual' / 'forecast': from the Revenue Recognition Summary (read only); 'manual': typed in */
  sources: Record<string, 'actual' | 'forecast' | 'manual'>;
};

export function ComparativesPanel({
  versionId,
  versionName,
  labels,
  rows,
  locked,
}: {
  versionId: number;
  versionName: string;
  labels: string[];
  rows: CompRow[];
  locked: boolean;
}) {
  const { pending, run, Msg } = useAction();
  const totals = labels.map((l) => rows.reduce((s, r) => s + (r.values[l] ?? 0), 0));
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-slate-600">
        Property-level comparatives for <b>{versionName}</b>: forecast for the current year and actuals for prior years. Properties in the Revenue
        Recognition Summary (Admin → Revenue Recognition Summary) take their actuals from it, and the forecast is actual to date plus the Lease Budget for the
        remaining months: those cells are calculated. Type the others below, or upload an Excel sheet with a <code>Code</code> column and one column
        per label.
      </p>
      {!locked && (
        <form className="card flex flex-wrap items-center gap-3 px-3 py-2 text-[13px]" action={(f) => run(() => importComparatives(versionId, f))}>
          <span className="font-medium">Upload from Excel</span>
          <input type="file" name="file" accept=".xlsx,.xls,.xlsm" className="text-xs" required />
          <button className="btn-primary" disabled={pending}>
            {pending ? 'Importing…' : 'Import'}
          </button>
          <a className="text-sky-700 hover:underline" href="/api/export/comparatives">
            Download template with current values
          </a>
          <span className="ml-auto">
            <Msg />
          </span>
        </form>
      )}
      <div className="frame frame-tall">
        <table className="tbl tbl-fit">
          <thead>
            <tr>
              <th className="stick stick-edge w-24">Code</th>
              <th className="w-80">Property</th>
              <th className="w-16">BU</th>
              {labels.map((l) => (
                <th key={l} className="num sep w-36">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="stick stick-edge muted">{r.code}</td>
                <td>{r.name}</td>
                <td className="muted">{r.bu}</td>
                {labels.map((l) => (
                  <td
                    key={l}
                    className={`num sep ${r.sources[l] !== 'manual' ? 'cell-derived' : ''}`}
                    title={r.sources[l] === 'actual' ? 'Revenue Recognition Summary' : r.sources[l] === 'forecast' ? 'Actual to date + Lease Budget' : undefined}
                  >
                    {locked || r.sources[l] !== 'manual' ? (
                      fmt(r.values[l])
                    ) : (
                      <input
                        className="cell-edit text-right"
                        defaultValue={r.values[l] === null || r.values[l] === undefined ? '' : fmt(r.values[l])}
                        placeholder="–"
                        onBlur={(e) => {
                          const raw = e.target.value.replace(/[,\s()]/g, '');
                          const v = raw === '' || raw === '-' ? null : Number(raw);
                          if (v !== null && !Number.isFinite(v)) return;
                          if (v !== r.values[l]) run(() => saveComparative({ versionId, propertyId: r.id, label: l, amount: v }).then((x) => ({ ...x, ok: x.error ? undefined : 'Saved' })));
                        }}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="tbl-total">
              <td className="stick stick-edge" colSpan={3}>
                Total
              </td>
              {totals.map((t, i) => (
                <td key={labels[i]} className="num sep">
                  {fmt(t)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- lease data: Tenant and Lease Details Report ------------------------------------------------

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function ListBlock<T>({ title, hint, items, cols, row }: { title: string; hint: string; items: T[]; cols: string[]; row: (x: T) => React.ReactNode[] }) {
  if (!items.length) return null;
  return (
    <details className="card p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        {title} <span className="font-normal text-slate-500">({count(items.length)})</span>
        <span className="ml-2 text-xs font-normal text-slate-500">{hint}</span>
      </summary>
      <div className="frame mt-2 max-h-80 overflow-auto">
        <table className="tbl">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 500).map((x, i) => (
              <tr key={i}>
                {row(x).map((v, j) => (
                  <td key={j}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > 500 && <div className="mt-1 text-xs text-slate-500">First 500 of {count(items.length)} shown.</div>}
    </details>
  );
}

export function LeaseImportPanel({
  versionId,
  versionName,
  locked,
  stats,
}: {
  versionId: number;
  versionName: string;
  locked: boolean;
  stats: { lines: number; leased: number; lastImport: string | null; lastFile: string | null };
}) {
  const [files, setFiles] = useState<{ file?: File; dump?: File; mf?: File }>({});
  const [form, setForm] = useState<FormData | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const apply = useAction();

  // any file change re-runs the preview with all three
  const onFile = (key: 'file' | 'dump' | 'mf') => (e: React.ChangeEvent<HTMLInputElement>) => {
    setPreview(null);
    setError(null);
    const next = { ...files, [key]: e.target.files?.[0] };
    setFiles(next);
    if (!next.file) return setForm(null);
    const f = new FormData();
    for (const k of ['file', 'dump', 'mf'] as const) if (next[k]) f.set(k, next[k]!);
    setForm(f);
    startCheck(async () => {
      const r = await previewLeaseImport(versionId, f);
      setError(r.error ?? null);
      setPreview(r.preview ?? null);
    });
  };
  const counts = (m: Record<string, number>) =>
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${count(n)}`)
      .join(' · ');

  const p = preview;
  return (
    <div className="space-y-4">
      <section className="card p-4">
        <h3 className="text-sm font-semibold">Tenant and Lease Details Report</h3>
        <p className="mt-1 max-w-4xl text-xs text-slate-500">
          Export it from Oracle (Custom Applications → Lease Reports → Reports → <b>Tenant and Lease Details Report</b>) for all business units, then
          choose the file here. It is the only source for the unit list and current leases: one line per lease (a lease on several units is one
          line) and one per available unit, with unit type, area, status, tenant, contract dates, rent, deposit, other charges and contracted later
          years. Add the <b>Unit Dump</b> for landlord, merged unit no., unit usage and unit status, and the <b>Maintenance Fee Report</b> for MF
          Yes / No / Waived off, amount, paid and outstanding. Without them, those fields keep their last import. Choosing a file shows what would change; nothing is saved until you click{' '}
          <b>Import</b>. The lines of <b>{versionName}</b> are rebuilt; budget inputs (outcome, budget rate, overrides, cheques, notes) stay with
          their unit. Personal data in the report (phone, email, passport, Emirates ID) is not read.
        </p>
        <div className="mt-3 text-xs text-slate-600">
          {count(stats.leased)} of {count(stats.lines)} lines have a current lease · last import {stats.lastImport ?? 'never'}
          {stats.lastFile && <> ({stats.lastFile})</>}
        </div>
        {locked ? (
          <div className="mt-3 text-xs text-amber-700">This version is locked.</div>
        ) : (
          <>
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">Tenant and Lease Details Report</span>
              <input type="file" accept=".xlsx,.xls" onChange={onFile('file')} className="text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">Unit Dump (optional)</span>
              <input type="file" accept=".xls,.xlsx,.htm,.html,.mht" onChange={onFile('dump')} className="text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">Maintenance Fee Report (optional)</span>
              <input type="file" accept=".xls,.xlsx,.htm,.html,.mht" onChange={onFile('mf')} className="text-xs" />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {checking && <span className="text-sm text-slate-500">Reading the reports…</span>}
            <button
              className="btn-primary"
              disabled={!form || !p || apply.pending}
              onClick={() => form && apply.run(async () => {
                const r = await applyLeaseImport(versionId, form);
                if (!r.error) setPreview(null);
                return r;
              })}
            >
              {apply.pending ? 'Importing…' : 'Import'}
            </button>
            <apply.Msg />
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
          </>
        )}
      </section>

      {p && (
        <div className="space-y-3">
          <div className="text-sm font-semibold">
            Preview <span className="font-normal text-slate-500">· contracts as of {p.asOf} · nothing saved yet</span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Report" value={`${count(p.report.units)} units`} sub={`${count(p.report.leases)} leases · ${count(p.report.available)} available · ${count(p.report.rows)} rows`} />
            <Tile
              label="Budget lines after import"
              value={`${count(p.result.lines)} lines`}
              sub={`${count(p.result.leasedLines)} leased (${count(p.result.multiUnitLines)} on several units) · ${count(p.result.vacantLines)} available`}
            />
            <Tile label="Current annual rent" value={`AED ${fmt(p.result.currentRent)}`} sub="current contract year, all lines" />
            <Tile label="Contracted later years" value={`${count(p.result.contractedLines)} lines`} sub="set as fixed renewals" />
            {p.dump && (
              <Tile
                label="Unit Dump"
                value={`${count(p.dump.matched)} lines matched`}
                sub={`${count(p.dump.unmatched)} not in the dump · ${counts(p.dump.status)}`}
              />
            )}
            {p.mf && (
              <Tile
                label="Maintenance fee"
                value={`${count(p.mf.matched)} leases matched`}
                sub={`${count(p.mf.unmatched)} leased lines not in the report · ${counts(p.mf.status)} · AED ${fmt(p.mf.amount)}, outstanding ${fmt(p.mf.outstanding)}`}
              />
            )}
          </div>
          <div className="frame max-w-2xl">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Business unit</th>
                  <th className="num">Leased lines</th>
                  <th className="num">Current rent (AED)</th>
                </tr>
              </thead>
              <tbody>
                {p.result.byBu.map((b) => (
                  <tr key={b.bu}>
                    <td>{b.bu}</td>
                    <td className="num tabular-nums">{count(b.leases)}</td>
                    <td className="num tabular-nums">{fmt(b.rent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-slate-500">{count(p.kept)} lines keep their unit code and budget inputs.</div>
          <ListBlock
            title="Lines removed"
            hint="not in the report, or now part of a lease covering several units; budget inputs on them are dropped"
            items={p.removedLines}
            cols={['Property', 'Line', 'Tenant (before)', 'Had budget inputs']}
            row={(x) => [x.property, x.code, x.tenant ?? '', x.inputs ? 'Yes' : '']}
          />
          <ListBlock
            title="New lines"
            hint="units and leases not in the budget yet"
            items={p.newLines}
            cols={['Property', 'Unit', 'Tenant', 'Units in lease', 'Current rent']}
            row={(x) => [x.property, x.code, x.tenant ?? '(available)', x.units, x.rent === null ? '' : fmt(x.rent)]}
          />
          <ListBlock title="New properties" hint="set the property manager in Admin → Properties" items={p.newProperties} cols={['Code', 'Name', 'BU']} row={(x) => [x.code, x.name, x.bu]} />
          <ListBlock title="Not imported" hint="" items={p.skipped} cols={['What', 'Why']} row={(x) => [x.what, x.detail]} />
          <ListBlock title="Overlapping leases" hint="one budget line with more than one running lease" items={p.conflicts} cols={['Detail']} row={(x) => [x]} />
        </div>
      )}
    </div>
  );
}

// ---- revenue actuals: Revenue Recognition Summary → Revenue Analysis -----------------------------

export function RevenueImportPanel({ year, last }: { year: number; last: { at: string; file: string | null; to: string | null } | null }) {
  const [form, setForm] = useState<FormData | null>(null);
  const [preview, setPreview] = useState<RrPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const apply = useAction();

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPreview(null);
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return setForm(null);
    const f = new FormData();
    f.set('file', file);
    setForm(f);
    startCheck(async () => {
      const r = await previewRevenueImport(f);
      setError(r.error ?? null);
      setPreview(r.preview ?? null);
    });
  };

  const p = preview;
  return (
    <div className="space-y-4">
      <section className="card p-4">
        <h3 className="text-sm font-semibold">Revenue Recognition Summary</h3>
        <p className="mt-1 max-w-4xl text-xs text-slate-500">
          Rent revenue recognised per property and month, from Oracle (Property Manager → Revenue Recognition Summary, accounting periods Jan-
          {year - 3} to the last closed month). It gives Revenue Analysis its actuals ({year - 3}A, {year - 2}A) and the actual part of {year - 1}F;
          the months after the last closed month are projected from the Lease Budget inputs. Oracle&apos;s own forecast in the report is kept for
          reference only. An import replaces the revenue actuals of the properties in the file.
        </p>
        <div className="mt-3 text-xs text-slate-600">
          Last import {last ? fmtDateTime(last.at) : 'never'}
          {last?.file && <> ({last.file})</>}
          {last?.to && <> · actuals to {last.to}</>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input type="file" accept=".xlsx,.xls,.htm,.html,.mht" onChange={onFile} className="text-xs" />
          {checking && <span className="text-sm text-slate-500">Reading the report…</span>}
          <button
            className="btn-primary"
            disabled={!form || !p || apply.pending}
            onClick={() =>
              form &&
              apply.run(async () => {
                const r = await applyRevenueImportAction(form);
                if (!r.error) setPreview(null);
                return r;
              })
            }
          >
            {apply.pending ? 'Importing…' : 'Import'}
          </button>
          <apply.Msg />
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </section>

      {p && (
        <div className="space-y-3">
          <div className="text-sm font-semibold">
            Preview <span className="font-normal text-slate-500">· nothing saved yet</span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Report" value={`${p.matched} properties`} sub={`Accounting periods ${p.accountingPeriods ?? '—'} · forecast ${p.forecastPeriod ?? '—'}`} />
            {p.years.map((y) => (
              <Tile key={y.year} label={`${y.year} actual`} value={`AED ${fmt(y.amount)}`} sub={`${y.months} month${y.months === 1 ? '' : 's'}`} />
            ))}
            <Tile label="Oracle forecast (reference)" value={`AED ${fmt(p.oracleForecast)}`} sub={p.forecastPeriod ?? undefined} />
          </div>
          <ListBlock
            title="Not in the budget"
            hint="property codes in the report with no budget property; not imported"
            items={p.unmatched}
            cols={['Code', 'Name', 'Actual (all months)']}
            row={(x) => [x.code, x.name, fmt(x.amount)]}
          />
        </div>
      )}
    </div>
  );
}

// ---- GL actuals: Account Analysis Report → Other Income ----------------------------------------

export function GlImportPanel({
  ledger,
  companies,
  versionId,
  versionName,
  year,
  locked,
  last,
}: {
  ledger: GlLedger;
  companies: string[];
  versionId: number;
  versionName: string;
  year: number;
  locked: boolean;
  last: { at: string; file: string | null } | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<{ values: GlValue[]; preview: GlPreview; fm: { rows: FmActual[]; preview: FmActualsPreview } | null; boh: { rows: BohActual[]; preview: BohActualsPreview } | null; ga: { rows: AdminActual[]; preview: AdminActualsPreview } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const apply = useAction();
  const label = { A2: `${year - 3}A`, A1: `${year - 2}A`, YTD: `${year - 1} Jan–Sep` };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPlan(null);
    setError(null);
    if (!f) return;
    setReading(true);
    try {
      // sent as the raw body: the server reads it as a stream
      const res = await fetch(`/api/import/gl?v=${versionId}&ledger=${encodeURIComponent(ledger)}`, { method: 'POST', body: f });
      const json = await res.json();
      if (json.error) setError(json.error);
      else setPlan(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReading(false);
    }
  };

  const p = plan?.preview;
  return (
    <div className="space-y-4">
      <section className="card p-4">
        <h3 className="text-sm font-semibold">Account Analysis Report · {ledger}</h3>
        <p className="mt-1 max-w-4xl text-xs text-slate-500">
          Other income actuals for <b>{versionName}</b>: {label.A2}, {label.A1} and {label.YTD}, from the Oracle Account Analysis Report (ledger {ledger},
          companies {companies.join(', ')}, Jan-{String(year - 3).slice(2)} to Sep-{String(year - 1).slice(2)}).{' '}
          {ledger === 'MJN HOLDING'
            ? 'Accounts 52xxx are read by property; company-level lines and properties not in the budget go to the General row of their business unit.'
            : 'Accounts 52xxx go to the General row of each company.'}{' '}
          {ledger === 'MJN HOLDING' && 'The same file carries the FM cost actuals (627xx, 117xx), the building overhead actuals (Building Overheads tab) and the G&A actuals by department (Admin Overheads tab).'}{' '}
          An import replaces this ledger&apos;s GL actuals; the other ledger, Oct–Dec and budget inputs are kept.
        </p>
        <div className="mt-3 text-xs text-slate-600">
          Last import {last ? fmtDateTime(last.at) : 'never'}
          {last?.file && <> ({last.file})</>}
        </div>
        {locked ? (
          <div className="mt-3 text-xs text-amber-700">This version is locked.</div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input type="file" accept=".xls,.xlsx,.htm,.html,.mht" onChange={onFile} className="text-xs" />
            {reading && <span className="text-sm text-slate-500">Reading the report… a full-ledger file takes a minute</span>}
            <button
              className="btn-primary"
              disabled={!plan || apply.pending}
              onClick={() =>
                plan &&
                apply.run(async () => {
                  const r = await applyGlActuals(versionId, plan.values, plan.preview, file?.name ?? null, plan.fm, plan.boh, plan.ga);
                  if (!r.error) setPlan(null);
                  return r;
                })
              }
            >
              {apply.pending ? 'Importing…' : 'Import'}
            </button>
            <apply.Msg />
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        )}
      </section>

      {p && (
        <div className="space-y-3">
          <div className="text-sm font-semibold">
            Preview <span className="font-normal text-slate-500">· nothing saved yet</span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Report" value={p.ledger ?? '—'} sub={`${p.periodFrom} – ${p.periodTo} · ${count(p.accounts)} accounts · ${count(p.lines)} lines · all reconciled`} />
            <Tile label={label.A2} value={`AED ${fmt(p.totals.A2)}`} />
            <Tile label={label.A1} value={`AED ${fmt(p.totals.A1)}`} />
            <Tile label={label.YTD} value={`AED ${fmt(p.totals.YTD)}`} sub={`${p.properties} properties`} />
          </div>
          <div className="frame max-w-3xl">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Business unit</th>
                  <th className="num">{label.A2}</th>
                  <th className="num">{label.A1}</th>
                  <th className="num">{label.YTD}</th>
                </tr>
              </thead>
              <tbody>
                {p.byBu.map((b) => (
                  <tr key={b.bu}>
                    <td>{b.bu}</td>
                    <td className="num tabular-nums">{fmt(b.A2)}</td>
                    <td className="num tabular-nums">{fmt(b.A1)}</td>
                    <td className="num tabular-nums">{fmt(b.YTD)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListBlock
            title="On General rows"
            hint="company-level lines, and property codes not in the budget"
            items={p.general}
            cols={['Business unit', 'Company', 'Property code', 'What', label.A2, label.A1, label.YTD]}
            row={(x) => [x.bu, x.company, x.segment, x.name, fmt(x.A2), fmt(x.A1), fmt(x.YTD)]}
          />
          <ListBlock title="Not imported" hint="" items={p.skipped} cols={['What', 'Why']} row={(x) => [x.what, x.detail]} />
          {plan?.fm && (
            <>
              <div className="pt-2 text-sm font-semibold">
                FM cost actuals <span className="font-normal">· {plan.fm.preview.from} to {plan.fm.preview.to}, replaced for these months</span>
              </div>
              <div className="frame max-w-xl">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th className="num">Maintenance 627xx</th>
                      <th className="num">Capex 117xx</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.fm.preview.byYear.map((y) => (
                      <tr key={y.year}>
                        <td>{y.year}</td>
                        <td className="num tabular-nums">{fmt(y.maintenance)}</td>
                        <td className="num tabular-nums">{fmt(y.capex)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ListBlock
                title="FM costs on buildings not in the budget"
                hint="kept at company level"
                items={plan.fm.preview.unmatched}
                cols={['Property code', 'AED']}
                row={(x) => [x.segment, fmt(x.amount)]}
              />
            </>
          )}
          {plan?.boh && (
            <>
              <div className="pt-2 text-sm font-semibold">
                Building overhead actuals <span className="font-normal">· {plan.boh.preview.from} to {plan.boh.preview.to}, replaced for these months</span>
              </div>
              <div className="frame">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Year</th>
                      {Object.keys(plan.boh.preview.byYear[0]?.lines ?? {}).map((l) => (
                        <th key={l} className="num">
                          {l}
                        </th>
                      ))}
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.boh.preview.byYear.map((y) => (
                      <tr key={y.year}>
                        <td>{y.year}</td>
                        {Object.entries(y.lines).map(([l, v]) => (
                          <td key={l} className="num tabular-nums">
                            {fmt(v)}
                          </td>
                        ))}
                        <td className="num tabular-nums font-semibold">{fmt(y.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ListBlock
                title="Building overheads on buildings not in the budget"
                hint={`not imported · company-level lines (G&A, AED ${fmt(plan.boh.preview.companyLevel)}) are left out too`}
                items={plan.boh.preview.unmatched}
                cols={['Property code', 'AED']}
                row={(x) => [x.segment, fmt(x.amount)]}
              />
            </>
          )}
          {plan?.ga && (
            <>
              <div className="pt-2 text-sm font-semibold">
                G&amp;A actuals by department <span className="font-normal">· {plan.ga.preview.from} to {plan.ga.preview.to}, replaced for these months</span>
              </div>
              <div className="frame max-w-2xl">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th className="num">Payroll</th>
                      <th className="num">Admin overheads</th>
                      <th className="num">Salary allocated to buildings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.ga.preview.byYear.map((y) => (
                      <tr key={y.year}>
                        <td>{y.year}</td>
                        <td className="num tabular-nums">{fmt(y.payroll)}</td>
                        <td className="num tabular-nums">{fmt(y.admin)}</td>
                        <td className="num tabular-nums">{fmt(y.allocation)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
