'use client';

// Side form for one Lease Budget row: every field, grouped by where it comes from. Oracle fields are
// fixed (Oracle import); budget inputs open up depending on the lease (see leaseTiming).

import { useState, type ReactNode } from 'react';
import { MF_CHOICES, MF_LABEL, defaultMfRenewal, type MasterRow, type MfChoice, type RowPatch } from '@/lib/budget/master-types';
import { fmt, MONTHS, pct } from '@/lib/format';
import { ScheduleEditor } from './schedule-editor';
import { OUTCOMES, annualRent, dmy, leaseTiming, outcomeOf, outcomePatch, rentPsf, type Outcome } from './row-logic';

type Row = MasterRow;
type Draft = Record<string, unknown>;

// left rule by cell state, never colour: ink where you enter values, gray for Oracle, hairline for calculated
const TONE = { unit: 'var(--control-border)', oracle: 'var(--control-border)', input: 'var(--ink)', calc: 'var(--line)' } as const;

function Section({ title, tone, note, children }: { title: string; tone: keyof typeof TONE; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-slate-200 bg-white" style={{ borderLeft: `3px solid ${TONE[tone]}` }}>
      <header className="flex items-baseline gap-2 border-b border-slate-200 px-3 py-1.5">
        <h3 className="text-[13px] font-semibold text-slate-900">{title}</h3>
        {note && <span className="text-[11px] text-slate-500">{note}</span>}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

const Grid = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 2xl:grid-cols-3">{children}</div>;

function Field({ label, hint, locked, wide, children }: { label: string; hint?: string; locked?: string | false; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`flex min-w-0 flex-col gap-0.5 ${wide ? 'col-span-full' : ''}`}>
      <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500" title={locked || undefined}>
        {label}
        {locked && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-label="locked">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        )}
      </span>
      {children}
      {hint && <span className="text-[10px] text-slate-400">{hint}</span>}
    </label>
  );
}

// read-only values: dashed outline, no fill, so they never look like inputs
/** RERA low / high rent for the row's property and bedroom code: entered by the PM, saved on its own. */
function ReraEditor({ row, canEdit, onSave }: { row: Row; canEdit: boolean; onSave?: (min: number | null, max: number | null) => Promise<string | null> }) {
  const [min, setMin] = useState(row.reraMin === null ? '' : String(row.reraMin));
  const [max, setMax] = useState(row.reraMax === null ? '' : String(row.reraMax));
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const parse = (s: string) => (s.replace(/,/g, '').trim() === '' ? null : Number(s.replace(/,/g, '')));
  const dirty = parse(min) !== row.reraMin || parse(max) !== row.reraMax;
  if (!canEdit)
    return (
      <div className="text-xs text-slate-600">
        {row.reraMin === null ? 'Not entered yet.' : `Low ${fmt(row.reraMin)} · High ${fmt(row.reraMax)}`}
        {!row.bedroom && ' The unit has no bedroom / RERA code.'}
      </div>
    );
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] font-medium text-slate-500">Low (annual rent)</span>
        <input className="input w-36 text-right tabular-nums" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="blank" />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] font-medium text-slate-500">High (annual rent)</span>
        <input className="input w-36 text-right tabular-nums" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder="blank" />
      </label>
      <button
        className="btn-primary btn-xs"
        disabled={!dirty || busy}
        onClick={async () => {
          const lo = parse(min), hi = parse(max);
          if ((lo !== null && !Number.isFinite(lo)) || (hi !== null && !Number.isFinite(hi))) return setMsg({ error: 'Enter numbers' });
          setBusy(true);
          const err = await onSave!(lo, hi);
          setBusy(false);
          setMsg(err ? { error: err } : { ok: 'Saved · units with this code recalculated' });
        }}
      >
        {busy ? 'Saving…' : 'Save RERA'}
      </button>
      <span className={`text-xs ${msg?.error ? 'text-red-600' : 'text-emerald-700'}`}>{msg?.error ?? msg?.ok ?? (row.reraMin === null ? 'Blank: renewals get no increase until entered' : '')}</span>
    </div>
  );
}

const ro ='w-full min-h-[30px] cursor-default truncate rounded-md border border-dashed border-slate-200 bg-transparent px-2 py-1 text-slate-600';
const box = (changed: boolean, override?: boolean) => `input w-full ${changed ? 'ring-1 ring-sky-500' : ''} ${override ? 'cell-override' : ''}`;

export function RowForm({
  row,
  year,
  staffDiscount,
  mfPct,
  isAdmin,
  onSave,
  onClose,
  onPrev,
  onNext,
  onRemove,
  onSaveRera,
}: {
  row: Row;
  year: number;
  staffDiscount: number;
  mfPct: number;
  isAdmin: boolean;
  /** saves the RERA range of this row's property and bedroom code; resolves to an error message or null */
  onSaveRera?: (min: number | null, max: number | null) => Promise<string | null>;
  /** saves a patch; resolves to an error message or null */
  onSave: (patch: RowPatch) => Promise<string | null>;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onRemove?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = Object.keys(draft).length;

  const val = <K extends keyof Row>(k: K): Row[K] => (k in draft ? (draft[k as string] as Row[K]) : row[k]);
  const set = (k: keyof Row, v: unknown) =>
    setDraft((d) => {
      const n = { ...d };
      if (JSON.stringify(v ?? null) === JSON.stringify(row[k] ?? null)) delete n[k as string];
      else n[k as string] = v;
      return n;
    });
  const changed = (k: string) => k in draft;

  const canEdit = row.editable;
  // anything from the Oracle import is fixed, for every role (isAdmin no longer unlocks it)
  void isAdmin;
  const canOracle = false;
  const oracleLock = 'Fixed: from the Oracle import';
  const owner = val('staffOwner') === 'OWNER';
  const timing = leaseTiming(row, year);
  const outcome = outcomeOf({ renew1: val('renew1'), noRenewal: val('noRenewal'), currentEnd: val('currentEnd') });
  const contractedLock = row.contracted > 0;
  const decisionOpen = canEdit && !owner && !contractedLock;
  const camp = row.propertyKind === 'CAMP';
  const rateUnit = camp ? 'AED per bed per month' : row.rc === 'R' ? 'annual rent' : 'AED per sq ft per year';
  const mfDefault = defaultMfRenewal({ rc: row.rc, renew1: val('renew1'), noRenewal: val('noRenewal'), mfCurrent: row.mfCurrent, vacant: row.vacant });

  const confirmLeave = (go?: () => void) => () => {
    if (!go) return;
    if (dirty && !confirm('Discard unsaved changes?')) return;
    go();
  };
  const save = async () => {
    setSaving(true);
    const err = await onSave(draft as RowPatch);
    setSaving(false);
    setError(err);
    if (!err) setDraft({});
  };

  // ---- inputs ------------------------------------------------------------------------------
  const text = (k: keyof Row, enabled: boolean) =>
    enabled ? (
      <input className={box(changed(k as string))} value={(val(k) as string | null) ?? ''} onChange={(e) => set(k, e.target.value.trim() === '' ? null : e.target.value)} />
    ) : (
      <div className={ro}>{(val(k) as string | null) || '—'}</div>
    );
  const num = (k: keyof Row, enabled: boolean, opts: { int?: boolean; placeholder?: string; override?: boolean } = {}) =>
    enabled ? (
      <input
        className={`${box(changed(k as string), opts.override && val(k) !== null)} text-right tabular-nums`}
        inputMode="decimal"
        placeholder={opts.placeholder}
        value={val(k) === null || val(k) === undefined ? '' : String(val(k))}
        onChange={(e) => {
          const s = e.target.value.replace(/,/g, '').trim();
          const n = s === '' ? null : Number(s);
          if (n === null || Number.isFinite(n)) set(k, n === null ? null : opts.int ? Math.round(n) : n);
        }}
      />
    ) : (
      <div className={`${ro} text-right tabular-nums`}>{val(k) === null || val(k) === undefined ? opts.placeholder || '—' : fmt(val(k) as number)}</div>
    );
  const date = (k: keyof Row, enabled: boolean, opts: { placeholder?: string | null; override?: boolean } = {}) =>
    enabled ? (
      <div className="flex items-center gap-1">
        <input
          type="date"
          className={box(changed(k as string), opts.override && val(k) !== null)}
          value={(val(k) as string | null) ?? opts.placeholder ?? ''}
          onChange={(e) => set(k, e.target.value || null)}
        />
        {opts.override && val(k) !== null && (
          <button type="button" className="text-xs text-slate-400 hover:text-red-600" title="Back to the calculated date" onClick={() => set(k, null)}>
            ×
          </button>
        )}
      </div>
    ) : (
      <div className={ro}>{dmy((val(k) as string | null) ?? opts.placeholder) || '—'}</div>
    );
  const show = (v: ReactNode, right = false) => <div className={`${ro} ${right ? 'text-right tabular-nums' : ''}`}>{v === null || v === undefined || v === '' ? '—' : v}</div>;

  const timingNote = {
    vacant: 'No current lease: budget a new letting (New tenant, start date and budget rate) or leave it vacant (Not re-let).',
    beyond: `Runs to ${dmy(row.currentEnd)}, beyond ${year}: no decision needed.`,
    expired: `Expired on ${dmy(row.currentEnd)}: renewal pending, choose the outcome.`,
    ends: `Ends on ${dmy(row.currentEnd)}: choose the outcome.`,
  }[timing.kind];

  const renewals = ([1, 2, 3] as const).filter((i) => row[`r${i}`] || val(`r${i}Start`) || val(`r${i}Rent`));
  const schedules = [
    row.current && { key: 'current', title: 'Current lease', c: row.current, field: 'currentSchedule' as const, note: 'Not in the Oracle report: enter the actual cheques here' },
    row.r1 && { key: 'r1', title: outcome === 'Renew' ? '1st renewal' : '1st renewal · new tenant', c: row.r1, field: 'r1Schedule' as const },
    row.r2 && { key: 'r2', title: '2nd renewal', c: row.r2, field: 'r2Schedule' as const },
    row.r3 && { key: 'r3', title: '3rd renewal', c: row.r3, field: 'r3Schedule' as const },
  ].filter(Boolean) as { key: string; title: string; c: NonNullable<Row['r1']>; field: 'currentSchedule' | 'r1Schedule' | 'r2Schedule' | 'r3Schedule'; note?: string }[];

  return (
    <aside aria-label="Row form" className="flex h-full min-h-0 w-1/2 shrink-0 flex-col border-l-2 border-sky-700 bg-slate-50 text-[13px]">
      {/* header */}
      <div className="flex items-start gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">
            {row.unitCode} <span className="font-normal text-slate-400">·</span> {row.tenant ?? 'No current lease'}
          </div>
          <div className="truncate text-xs text-slate-500">
            {row.propertyName} · {row.buName} · PC {row.coordinator ?? '—'}
            {!canEdit && ' · read only'}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button className="btn btn-xs" disabled={!onPrev} onClick={confirmLeave(onPrev)} title="Previous row">
            ↑
          </button>
          <button className="btn btn-xs" disabled={!onNext} onClick={confirmLeave(onNext)} title="Next row">
            ↓
          </button>
          <button className="btn btn-xs" onClick={confirmLeave(onClose)}>
            Close
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {row.warnings.length > 0 && (
          <ul className="list-disc rounded-md border border-amber-200 bg-amber-50 py-1.5 pr-3 pl-7 text-xs text-amber-700">
            {row.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        <Section title="Unit" tone="unit" note="Oracle fields locked">
          <Grid>
            <Field label="Unit type (Oracle)" locked={oracleLock}>
              {text('resiCommercial', canOracle)}
            </Field>
            <Field label="Area (sq ft)" locked={oracleLock}>
              {num('area', canOracle)}
            </Field>
            <Field label="Unit status" locked={oracleLock}>
              {text('unitStatus', canOracle)}
            </Field>
            <Field label="Bedroom / RERA code" hint="From the unit type · key into the RERA index" locked={oracleLock}>
              {text('bedroom', canOracle)}
            </Field>
            <Field label="R / C / L" hint="R residential (no VAT) · C commercial · L labour" locked={oracleLock}>
              {canOracle ? (
                <select className={box(changed('rc'))} value={val('rc')} onChange={(e) => set('rc', e.target.value)}>
                  <option>R</option>
                  <option>C</option>
                  <option>L</option>
                </select>
              ) : (
                show(val('rc'))
              )}
            </Field>
            <Field label="Category" hint="From the unit type · groups the unit in reports" locked={oracleLock}>
              {text('pivotCategory', canOracle)}
            </Field>
            <Field label="Unit usage" locked={oracleLock}>
              {show(row.unitUsage)}
            </Field>
            <Field label="Merged unit no." locked={oracleLock}>
              {show(row.mergedUnitNumber)}
            </Field>
            <Field label="Landlord" locked={oracleLock}>
              {show(row.landlord)}
            </Field>
            {camp && (
              <>
                <Field label="Rooms" hint="Rooms in the lease (Oracle)" locked={oracleLock}>
                  {num('rooms', canOracle, { int: true })}
                </Field>
                <Field label="Beds" hint="Not in the Oracle report: enter it · camps are priced per bed">
                  {num('capacity', canEdit, { int: true })}
                </Field>
              </>
            )}
          </Grid>
        </Section>

        <Section title="Current lease" tone="oracle" note={row.leaseSyncedAt ? `Oracle import ${row.leaseSyncedAt.slice(0, 10)}` : 'Oracle'}>
          <Grid>
            <Field label="Tenant" locked={oracleLock} wide>
              {text('tenant', canOracle)}
            </Field>
            <Field label="Tenant code" locked={oracleLock}>
              {text('tenantCode', canOracle)}
            </Field>
            <Field label="Lease number" locked={oracleLock}>
              {text('leaseNumber', canOracle)}
            </Field>
            <Field label="Customer class" locked={oracleLock}>
              {text('customerClass', canOracle)}
            </Field>
            <Field label="Lease commencement" locked={oracleLock}>
              {date('rentStart', canOracle)}
            </Field>
            <Field label="Contract start" locked={oracleLock}>
              {date('currentStart', canOracle)}
            </Field>
            <Field label="Contract end" locked={oracleLock}>
              {date('currentEnd', canOracle)}
            </Field>
            <Field label="Contract amount" locked={oracleLock} hint="For the contract dates above">
              {num('currentRent', canOracle)}
            </Field>
            <Field label="Annual rent">{show(annualRent(row) === null ? null : fmt(annualRent(row)), true)}</Field>
            <Field label="Rent per sq ft">{show(rentPsf(row) === null ? null : fmt(rentPsf(row), 2), true)}</Field>
            <Field label="Security deposit" locked={oracleLock}>
              {num('securityDeposit', canOracle)}
            </Field>
            <Field label="MF" locked={oracleLock} hint="Maintenance fee: Yes / No / Waived off">
              {show(row.mfStatus ?? (row.mfCurrent === true ? 'Yes' : row.mfCurrent === false ? 'No' : null))}
            </Field>
            <Field label="MF amount" locked={oracleLock} hint="Other income · not in rent revenue">
              {show(row.maintenanceFee ? fmt(row.maintenanceFee) : null, true)}
            </Field>
            {row.mfStatus && (
              <>
                <Field label="MF paid" locked={oracleLock} hint={row.mfPaidDate ? `Last payment ${dmy(row.mfPaidDate)}` : undefined}>
                  {show(row.mfPaid === null ? null : fmt(row.mfPaid), true)}
                </Field>
                <Field label="MF outstanding" locked={oracleLock}>
                  {show(row.mfOutstanding === null ? null : fmt(row.mfOutstanding), true)}
                </Field>
              </>
            )}
            <Field label="Utility fee" hint="Other income">
              {show(row.utilityFee ? fmt(row.utilityFee) : null, true)}
            </Field>
            <Field label="Additional car park" hint="Other income">
              {show(row.carParkFee ? fmt(row.carParkFee) : null, true)}
            </Field>
            {row.leaseRemarks && (
              <Field label="Note" wide>
                {show(row.leaseRemarks)}
              </Field>
            )}
          </Grid>
        </Section>

        {row.contracted > 0 && (
          <Section title="Contracted later years" tone="oracle" note="Fixed in the lease: used as the renewals below">
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Start</th>
                  <th>End</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {([1, 2, 3] as const)
                  .filter((i) => i <= row.contracted)
                  .map((i) => (
                    <tr key={i}>
                      <td>{['1st', '2nd', '3rd'][i - 1]} renewal</td>
                      <td>{dmy(row[`r${i}Start`])}</td>
                      <td>{dmy(row[`r${i}End`])}</td>
                      <td className="num">{fmt(row[`r${i}Rent`])}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Section>
        )}

        <Section title="Budget decision" tone="input" note={timingNote}>
          <Grid>
            <Field label="Outcome" locked={contractedLock ? 'Fixed: settled by the contracted lease years (Oracle)' : false} hint={owner ? 'Owner-occupied: no renewal' : undefined}>
              {decisionOpen ? (
                <select
                  className={box(changed('renew1') || changed('noRenewal'))}
                  value={outcome}
                  onChange={(e) => {
                    const p = outcomePatch(e.target.value as Outcome);
                    set('renew1', p.renew1);
                    set('noRenewal', p.noRenewal);
                  }}
                >
                  {OUTCOMES.filter((o) => o !== 'Renew' || timing.kind !== 'vacant').map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                show(outcome)
              )}
            </Field>
            {outcome === 'Renew' && timing.kind !== 'vacant' && (
              <Field label="Increase %" hint={`Calculated from RERA: ${row.increasePct === null ? '—' : pct(row.increasePct)}. Type to override.`}>
                {decisionOpen ? (
                  <input
                    className={`${box(changed('increasePctOverride'), val('increasePctOverride') !== null)} text-right`}
                    inputMode="decimal"
                    placeholder={row.increasePct === null ? '' : String(Math.round(row.increasePct * 10000) / 100)}
                    value={val('increasePctOverride') === null ? '' : String(Math.round((val('increasePctOverride') as number) * 10000) / 100)}
                    onChange={(e) => {
                      const s = e.target.value.trim();
                      const n = s === '' ? null : Number(s);
                      if (n === null || Number.isFinite(n)) set('increasePctOverride', n === null ? null : n / 100);
                    }}
                  />
                ) : (
                  show(pct(val('increasePctOverride') ?? row.increasePct ?? 0), true)
                )}
              </Field>
            )}
            {outcome === 'New tenant' && (
              <>
                <Field label="Budget rate" hint={`New-tenant rate: ${rateUnit}`}>
                  {num('budgetRate', decisionOpen)}
                </Field>
                {timing.kind === 'vacant' ? (
                  <Field label="New tenant from" hint="Required">
                    {date('r1Start', decisionOpen, { placeholder: row.r1?.start ?? null, override: true })}
                  </Field>
                ) : (
                  <>
                    <Field label="Vacancy days" hint="Required · empty days after the lease ends">
                      {num('vacancyDays', decisionOpen, { int: true })}
                    </Field>
                    <Field label="New tenant from">{show(row.r1?.start ? dmy(row.r1.start) : null)}</Field>
                  </>
                )}
              </>
            )}
            {outcome !== 'Not re-let' && (
              <Field label={outcome === 'Renew' ? 'MF on renewal' : 'MF on new tenant'} hint={`${pct(mfPct)} of the rent · other income in the start month`}>
                {canEdit && !owner ? (
                  <select
                    className={box(changed('mfRenewal'), val('mfRenewal') !== null)}
                    value={val('mfRenewal') ?? ''}
                    onChange={(e) => set('mfRenewal', (e.target.value || null) as MfChoice | null)}
                  >
                    <option value="">Default: {MF_LABEL[mfDefault]}</option>
                    {MF_CHOICES.map((c) => (
                      <option key={c} value={c}>
                        {MF_LABEL[c]}
                      </option>
                    ))}
                  </select>
                ) : (
                  show(MF_LABEL[val('mfRenewal') ?? mfDefault])
                )}
              </Field>
            )}
            <Field label="Staff / Owner">
              {canEdit ? (
                <select className={box(changed('staffOwner'))} value={val('staffOwner') ?? ''} onChange={(e) => set('staffOwner', e.target.value || null)}>
                  <option value="">—</option>
                  <option value="STAFF">Staff (rent grossed up {Math.round(staffDiscount * 100)}% for RERA)</option>
                  <option value="OWNER">Owner (no renewal)</option>
                </select>
              ) : (
                show(val('staffOwner'))
              )}
            </Field>
            <Field label="Cheques per year" hint="Renewals; blank = 4">
              {num('cheques', canEdit, { int: true, placeholder: '4' })}
            </Field>
          </Grid>
        </Section>

        {renewals.length > 0 && (
          <Section title="Renewals" tone="input" note="Grey = calculated · bold = overridden (× reverts)">
            <div className="space-y-3">
              {renewals.map((i) => {
                const locked = i <= row.contracted;
                const d = row[`r${i}`];
                const open = canEdit && !owner && !locked;
                const renewKey = `r${i}Renew` as 'r2Renew' | 'r3Renew';
                return (
                  <div key={i}>
                    <div className="mb-1 text-xs font-semibold text-slate-700">
                      {['1st', '2nd', '3rd'][i - 1]} renewal
                      {i <= row.contracted && <span className="ml-2 font-normal text-teal-600">contracted (Oracle)</span>}
                      {i === 1 && outcome === 'New tenant' && <span className="ml-2 font-normal text-slate-500">new tenant</span>}
                    </div>
                    <Grid>
                      {i > 1 && (
                        <Field label="Renew">
                          {open ? (
                            <select
                              className={box(changed(renewKey))}
                              value={val(renewKey) === null ? '' : val(renewKey) ? 'Y' : 'N'}
                              onChange={(e) => set(renewKey, e.target.value === '' ? null : e.target.value === 'Y')}
                            >
                              <option value="">Automatic</option>
                              <option value="Y">Yes</option>
                              <option value="N">No</option>
                            </select>
                          ) : (
                            show(val(renewKey) === null ? 'Automatic' : val(renewKey) ? 'Yes' : 'No')
                          )}
                        </Field>
                      )}
                      <Field label="Start" locked={locked ? 'Fixed: contracted lease year (Oracle)' : false}>
                        {date(`r${i}Start`, open, { placeholder: d?.start ?? null, override: true })}
                      </Field>
                      <Field label="End" locked={locked ? 'Fixed: contracted lease year (Oracle)' : false}>
                        {date(`r${i}End`, open, { placeholder: d?.end ?? null, override: true })}
                      </Field>
                      <Field label="Rent" locked={locked ? 'Fixed: contracted lease year (Oracle)' : false} hint={d && row.area ? `${fmt(d.rent / row.area, 2)} per sq ft` : undefined}>
                        {num(`r${i}Rent`, open, { placeholder: d ? fmt(d.rent) : '', override: true })}
                      </Field>
                    </Grid>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {schedules.length > 0 && (
          <Section title="Cheque schedules" tone="input" note="Edit saves straight away">
            <div className="flex flex-wrap gap-3">
              {schedules.map(({ key, title, c, field, note }) => (
                <ScheduleEditor
                  key={key}
                  title={title}
                  contract={c}
                  year={year}
                  editable={canEdit}
                  overrideNote={note}
                  onSave={(items) => void onSave({ [field]: items } as RowPatch)}
                />
              ))}
            </div>
          </Section>
        )}

        <Section title="RERA index" tone="input" note={`${row.propertyCode} · ${row.bedroom ?? 'no RERA code'} · applies to every unit of this property with this code`}>
          <ReraEditor row={row} canEdit={canEdit && !!row.bedroom && !!onSaveRera} onSave={onSaveRera} />
          <div className="mt-3" />
          <Grid>
            <Field label="Average">{show(row.reraAverage === null ? null : fmt(row.reraAverage), true)}</Field>
            <Field label="Below RERA average">{show(row.reraGap === null ? null : pct(row.reraGap), true)}</Field>
            <Field label="Increase allowed">{show(row.increasePct === null ? null : pct(row.increasePct), true)}</Field>
            <Field label="Staff discount">{show(row.staffOwner === 'STAFF' ? pct(staffDiscount) : '0%', true)}</Field>
          </Grid>
        </Section>

        <Section title={`Result ${year}`} tone="calc" note="Recalculated on save">
          <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
            <span>
              Revenue <b className="text-slate-900 tabular-nums">{fmt(row.revenueTotal)}</b>
            </span>
            <span>
              Cash inflow <b className="text-slate-900 tabular-nums">{fmt(row.cashFlowTotal)}</b>
            </span>
            <span>
              Vacancy loss <b className="text-slate-900 tabular-nums">{fmt(row.vacancyLoss)}</b>
            </span>
            <span>
              Maintenance fee <b className="text-slate-900 tabular-nums">{fmt(row.maintenanceTotal)}</b>
            </span>
          </div>
          <div className="frame overflow-x-auto">
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th />
                  {MONTHS.map((m) => (
                    <th key={m} className="num">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Revenue', row.revenue],
                    ['Rent cheques', row.cash],
                    ['Cash inflow', row.cashFlow],
                  ] as const
                ).map(([label, vals]) => (
                  <tr key={label}>
                    <td className="whitespace-nowrap">{label}</td>
                    {vals.map((v, i) => (
                      <td key={i} className="num">
                        {fmt(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Notes" tone="input">
          {canEdit ? (
            <textarea className={`${box(changed('notes'))} min-h-16`} value={val('notes') ?? ''} onChange={(e) => set('notes', e.target.value || null)} />
          ) : (
            show(row.notes)
          )}
        </Section>

        {onRemove && (
          <div className="text-right">
            <button className="btn text-red-700" onClick={onRemove}>
              Remove unit from this budget
            </button>
          </div>
        )}
      </div>

      {/* save bar */}
      {canEdit && (
        <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-4 py-2">
          <span className={`text-xs ${error ? 'text-red-600' : 'text-slate-500'}`}>{error ?? (dirty ? `${dirty} unsaved change${dirty > 1 ? 's' : ''}` : 'No changes')}</span>
          <button className="btn ml-auto" disabled={!dirty || saving} onClick={() => (setDraft({}), setError(null))}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </aside>
  );
}
