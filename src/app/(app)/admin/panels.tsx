'use client';

import { useState, useTransition } from 'react';
import type { Assumptions } from '@/lib/engine/assumptions';
import { fmt } from '@/lib/format';
import { StatusBadge } from '@/components/status-badge';
import {
  setVersionStatus,
  createNextVersion,
  recalcVersion,
  saveAssumptions,
  upsertRera,
  deleteRera,
  upsertUser,
  updateProperty,
  importComparatives,
  importFusionLeases,
  importFusionUnits,
} from './actions';
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
            vacancyGapDays: n(f.get('vacancyGapDays')),
            renewalTermDays: n(f.get('renewalTermDays')),
            staffDiscount: n(f.get('staffDiscount')) / 100,
            reraBands: bands,
            labourIncrease: n(f.get('labourIncrease')) / 100,
            campIncrease: n(f.get('campIncrease')) / 100,
            defaultCheques: n(f.get('defaultCheques')),
            chequeSpanDays: n(f.get('chequeSpanDays')),
            vatRate: n(f.get('vatRate')) / 100,
            depositPct: n(f.get('depositPct')) / 100,
          }),
        )
      }
    >
      <h2 className="mb-2 font-semibold">Assumptions · {versionName}</h2>
      {field('vacancyGapDays', 'Vacancy gap for new tenants', a.vacancyGapDays, 'Days between a non-renewed lease ending and the new tenant starting', 1, 'days')}
      {field('renewalTermDays', 'Renewal term', a.renewalTermDays, 'Length of a renewed / new contract', 1, 'days')}
      {field('staffDiscount', 'Staff discount', a.staffDiscount, 'Grossed up when comparing staff rents with RERA', 100, '%')}
      {field('labourIncrease', 'Labour unit renewal increase', a.labourIncrease, 'R/C = L units outside the camps', 100, '%')}
      {field('campIncrease', 'Labour camp renewal increase', a.campIncrease, 'Camps (rate per bed)', 100, '%')}
      {field('defaultCheques', 'Cheques per contract', a.defaultCheques, 'Default when a unit has no cheque count', 1, '')}
      {field('chequeSpanDays', 'Cheque schedule span', a.chequeSpanDays, 'Cheque interval = span ÷ cheques (template: 370 ÷ 4 = 92.5 days)', 1, 'days')}
      {field('vatRate', 'VAT', a.vatRate, 'On commercial & labour rent; residential rent exempt. Included in cash inflow', 100, '%')}
      {field('depositPct', 'Security deposit', a.depositPct, 'Of annual rent: received from new tenants, refunded when a tenant leaves', 100, '%')}

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

// ---- RERA -------------------------------------------------------------------------------------

type ReraRow = { id: number; propertyCode: string; bedroom: string; unitType: string | null; min: number; max: number };

export function ReraPanel({
  versionId,
  versionName,
  locked,
  rows,
  properties,
}: {
  versionId: number;
  versionName: string;
  locked: boolean;
  rows: ReraRow[];
  properties: { code: string; name: string }[];
}) {
  const { pending, run, Msg } = useAction();
  const name = (code: string) => properties.find((p) => p.code === code)?.name ?? '';
  const save = (id: number | null, f: FormData) =>
    run(() =>
      upsertRera(versionId, id, {
        propertyCode: String(f.get('propertyCode') ?? ''),
        bedroom: String(f.get('bedroom') ?? ''),
        unitType: (f.get('unitType') as string) || null,
        min: n(f.get('min')),
        max: n(f.get('max')),
      }),
    );
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        RERA rental index for <b>{versionName}</b>. Residential ranges are annual rent; commercial ranges are AED per sq.ft. Units
        match on property code + bedroom code (the template&apos;s <code>E&amp;&quot;-&quot;&amp;H</code> key). Saving recalculates every unit.
      </p>
      <div className="flex items-center gap-3">
        {pending ? <span className="text-sm text-slate-500">Saving & recalculating…</span> : <Msg />}
      </div>
      <div className="frame">
        <table className="tbl">
          <thead>
            <tr>
              <th>Property code</th>
              <th>Property</th>
              <th>Bedroom</th>
              <th>Unit type</th>
              <th className="num">Min</th>
              <th className="num">Max</th>
              <th className="num">Average</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!locked && (
              <tr className="bg-sky-50">
                <td colSpan={8}>
                  <form className="flex flex-wrap items-center gap-2" action={(f) => save(null, f)}>
                    <span className="text-xs font-semibold">Add:</span>
                    <input name="propertyCode" list="rera-props" placeholder="Property code" required className="input w-32" />
                    <datalist id="rera-props">
                      {properties.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.name}
                        </option>
                      ))}
                    </datalist>
                    <input name="bedroom" placeholder="Bedroom (e.g. 2, 0, 104)" required className="input w-40" />
                    <input name="unitType" placeholder="Unit type" className="input w-40" />
                    <input name="min" placeholder="Min" required className="cell-edit text-right" />
                    <input name="max" placeholder="Max" required className="cell-edit text-right" />
                    <button className="btn-primary" disabled={pending}>
                      Add
                    </button>
                  </form>
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.propertyCode}</td>
                <td className="text-slate-600">{name(r.propertyCode)}</td>
                <td>{r.bedroom}</td>
                <td>{r.unitType}</td>
                <td className="num">
                  {locked ? (
                    fmt(r.min)
                  ) : (
                    <input
                      className="cell-edit text-right"
                      defaultValue={r.min}
                      onBlur={(e) => {
                        const v = n(e.target.value);
                        if (v !== r.min) {
                          const f = new FormData();
                          Object.entries({ ...r, min: v }).forEach(([k, x]) => f.set(k, String(x ?? '')));
                          save(r.id, f);
                        }
                      }}
                    />
                  )}
                </td>
                <td className="num">
                  {locked ? (
                    fmt(r.max)
                  ) : (
                    <input
                      className="cell-edit text-right"
                      defaultValue={r.max}
                      onBlur={(e) => {
                        const v = n(e.target.value);
                        if (v !== r.max) {
                          const f = new FormData();
                          Object.entries({ ...r, max: v }).forEach(([k, x]) => f.set(k, String(x ?? '')));
                          save(r.id, f);
                        }
                      }}
                    />
                  )}
                </td>
                <td className="num">{fmt((r.min + r.max) / 2)}</td>
                <td>
                  {!locked && (
                    <button className="text-xs text-red-600" disabled={pending} onClick={() => confirm('Delete this index row?') && run(() => deleteRera(versionId, r.id))}>
                      delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- properties -------------------------------------------------------------------------------

type PropRow = { id: number; code: string; name: string; buCode: string; coordinator: string | null; kind: 'BUILDING' | 'CAMP' | 'MALL'; active: boolean };

export function PropertiesPanel({ rows }: { rows: PropRow[] }) {
  const { pending, run, Msg } = useAction();
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        The coordinator (PC) decides which property manager can edit a property. Camps are priced per bed per month.
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
              <th>Kind</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td colSpan={7} className="p-0">
                  <form
                    className="grid grid-cols-[7rem_1fr_4rem_9rem_8rem_5rem_5rem] items-center gap-2 px-2 py-1"
                    action={(f) =>
                      run(() =>
                        updateProperty(p.id, {
                          name: String(f.get('name')),
                          coordinator: (f.get('coordinator') as string) || null,
                          kind: f.get('kind') as PropRow['kind'],
                          active: f.get('active') === 'on',
                        }),
                      )
                    }
                  >
                    <span className="text-slate-600">{p.code}</span>
                    <input name="name" defaultValue={p.name} className="input" />
                    <span>{p.buCode}</span>
                    <input name="coordinator" defaultValue={p.coordinator ?? ''} className="input" />
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

type UserRow = { id: number; email: string; name: string; role: 'ADMIN' | 'FINANCE' | 'PM'; coordinator: string | null; active: boolean };

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

type CompRow = { id: number; code: string; name: string; bu: string; values: Record<string, number | null> };

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
        Property-level comparatives for <b>{versionName}</b>: forecast for the current year and actuals for prior years. Once Fusion is connected,
        actuals will load from the GL. Type values below, or upload an Excel sheet with a <code>Code</code> column and one column per label.
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
                  <td key={l} className="num sep">
                    {locked ? (
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

// ---- Oracle Fusion data -------------------------------------------------------------------------

export function FusionPanel({
  versionId,
  versionName,
  locked,
  stats,
}: {
  versionId: number;
  versionName: string;
  locked: boolean;
  stats: { units: number; leased: number; lastLeaseSync: string | null; lastUnitSync: string | null; unitsWithStatus: number };
}) {
  const leases = useAction();
  const units = useAction();
  return (
    <div className="space-y-4">
      <p className="max-w-4xl text-[13px] text-slate-600">
        Current leases and unit attributes can be typed in the Lease Budget or loaded from Oracle Fusion. Until the Fusion connection
        is set up, upload the two standard Fusion exports here. Each upload overwrites the lease and unit fields it contains for{' '}
        <b>{versionName}</b> (including anything typed in) and recalculates every unit.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h3 className="text-sm font-semibold">2 · Lease Status Summary Report</h3>
          <p className="mt-1 text-xs text-slate-500">
            Lease number, version, tenant, customer class, lease / rent start, lease end, actual lease amount, VAT, security deposit,
            status and remarks — one row per leased unit. Units of the reported BUs that are not in the report lose their lease.
          </p>
          <div className="mt-3 text-xs text-slate-600">
            {stats.leased} of {stats.units} units have a lease · last loaded {stats.lastLeaseSync ?? 'never'}
          </div>
          {!locked && (
            <form className="mt-3 flex flex-wrap items-center gap-2" action={(f) => leases.run(() => importFusionLeases(versionId, f))}>
              <input type="file" name="file" accept=".xlsx,.xls" required className="text-xs" />
              <button className="btn-primary" disabled={leases.pending}>
                {leases.pending ? 'Loading…' : 'Load leases'}
              </button>
              <leases.Msg />
            </form>
          )}
        </section>
        <section className="card order-first p-4">
          <h3 className="text-sm font-semibold">1 · Unit Dump (load first)</h3>
          <p className="mt-1 text-xs text-slate-500">
            Unit status, merged unit number, unit usage (Resi / Commercial as per Fusion) and landlord. Load it first: leases on merged units are matched to their member units through the merged unit number.
          </p>
          <div className="mt-3 text-xs text-slate-600">
            {stats.unitsWithStatus} units have a Fusion status · last loaded {stats.lastUnitSync ?? 'never'}
          </div>
          {!locked && (
            <form className="mt-3 flex flex-wrap items-center gap-2" action={(f) => units.run(() => importFusionUnits(versionId, f))}>
              <input type="file" name="file" accept=".xlsx,.xls" required className="text-xs" />
              <button className="btn-primary" disabled={units.pending}>
                {units.pending ? 'Loading…' : 'Load units'}
              </button>
              <units.Msg />
            </form>
          )}
        </section>
      </div>
      <p className="text-xs text-slate-500">
        Once Fusion access is available, these uploads are replaced by a scheduled sync from Fusion (BI Publisher report service), using
        the same mapping. Lease cheque schedules will come from the lease Schedules in Fusion.
      </p>
    </div>
  );
}
