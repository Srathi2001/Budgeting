'use client';

// Admin overheads in the side form, as the Lease Budget's row form: a department (its payroll from HR and
// the 2026 rules, its overheads by GL account and paying company) and a management fee per landlord.

import { useState, useTransition } from 'react';
import { fmt, pct as pctOf } from '@/lib/format';
import { FormField, FormGrid, FormSection, FormTable, Num, NumIn, RecordForm, SelectIn, Show, useDraft } from '@/components/record-form';
import {
  ADMIN_ACCOUNT,
  ADMIN_ACCOUNTS,
  FEES,
  FEE_ENTITIES,
  PAYERS,
  anpmOverheads,
  deptName,
  feeAmount,
  payrollSplit,
  ruleOf,
  type AdminChange,
  type AdminData,
  type AdminRow,
  type FeeRow,
  type PayrollField,
  type PayrollRow,
} from '@/lib/budget/admin-types';
import { ITEM_KIND, SCHEDULE_ACCOUNT } from '@/lib/budget/admin-items';
import { saveAdminCells } from './actions';

/** the data after the changes the server took */
export function applyAdminChange(d: AdminData, c: AdminChange): AdminData {
  if (c.kind === 'payroll') return { ...d, payroll: d.payroll.map((p) => (p.dept === c.dept ? { ...p, [c.field]: c.value } : p)) };
  if (c.kind === 'fee')
    return {
      ...d,
      fees: d.fees.map((r) => {
        if (r.fee !== c.fee || r.entity !== c.entity) return r;
        const next = { ...r, [c.field]: c.value };
        return { ...next, amount: feeAmount(next) };
      }),
    };
  const exists = d.admin.some((r) => r.dept === c.dept && r.account === c.account);
  const blank = () => Object.fromEntries(PAYERS.map((p) => [p.code, null])) as Record<string, number | null>;
  const admin: AdminRow[] = exists
    ? d.admin.map((r) => (r.dept === c.dept && r.account === c.account ? { ...r, b: { ...r.b, [c.entity]: c.value } } : r))
    : [...d.admin, { dept: c.dept, account: c.account, a2: null, a1: null, ytd: null, f: null, b: { ...blank(), [c.entity]: c.value }, items: blank(), schedule: SCHEDULE_ACCOUNT.get(c.account) ?? null }];
  return { ...d, admin };
}

/** sends the changes one at a time, so what was taken is shown even when one is refused */
async function send(versionId: number, changes: AdminChange[]) {
  const ok: AdminChange[] = [];
  const errors: string[] = [];
  for (const c of changes) {
    const r = await saveAdminCells(versionId, [c]);
    if (r.errors.length) errors.push(...r.errors);
    else ok.push(c);
  }
  return { ok, errors };
}

interface Nav {
  versionId: number;
  year: number;
  locked: boolean;
  onSaved: (changes: AdminChange[]) => void;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

const PAYROLL_FIELDS: { key: PayrollField; label: string; kind: 'int' | 'amount' | 'pct' }[] = [
  { key: 'headcount', label: 'Headcount', kind: 'int' },
  { key: 'ctc', label: 'Cost to company', kind: 'amount' },
  { key: 'newHeadcount', label: 'New hires', kind: 'int' },
  { key: 'newCtc', label: 'New hires cost', kind: 'amount' },
  { key: 'capPct', label: 'Capitalised (%)', kind: 'pct' },
  { key: 'mjnhPct', label: 'To MJNH (%)', kind: 'pct' },
  { key: 'asrePct', label: 'To ASRE (%)', kind: 'pct' },
  { key: 'seniorCtc', label: 'Senior staff cost', kind: 'amount' },
];

export function DeptForm({
  dept,
  data,
  rows: initialRows,
  enterable,
  versionId,
  year,
  locked,
  onSaved,
  onClose,
  onPrev,
  onNext,
}: Nav & { dept: string; data: AdminData; rows: AdminRow[]; enterable: boolean }) {
  const p = data.payroll.find((x) => x.dept === dept);
  const rule = ruleOf(dept, data.rules);
  const [accounts, setAccounts] = useState(initialRows.map((r) => r.account));
  const rowOf = (account: string) => initialRows.find((r) => r.account === account);
  const stored: Record<string, number | null> = {};
  if (p) for (const f of PAYROLL_FIELDS) stored[`p|${f.key}`] = p[f.key];
  for (const a of accounts) for (const y of PAYERS) stored[`a|${a}|${y.code}`] = rowOf(a)?.b[y.code] ?? null;
  const d = useDraft(stored);
  const [saving, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canEditPay = !locked && !!p;
  const canEditOh = !locked && enterable;

  // the rows as typed, for the totals and the 2026 rules
  const typedRows: AdminRow[] = accounts.map((a) => {
    const r = rowOf(a);
    const blank = Object.fromEntries(PAYERS.map((y) => [y.code, null]));
    return { dept, account: a, a2: r?.a2 ?? null, a1: r?.a1 ?? null, ytd: r?.ytd ?? null, f: r?.f ?? null, b: Object.fromEntries(PAYERS.map((y) => [y.code, d.value[`a|${a}|${y.code}`] ?? null])), items: r?.items ?? blank, schedule: r?.schedule ?? SCHEDULE_ACCOUNT.get(a) ?? null };
  });
  const cell = (r: AdminRow, payer: string) => r.items[payer] ?? r.b[payer];
  const sum = (vs: (number | null | undefined)[]) => (vs.some((v) => v !== null && v !== undefined) ? vs.reduce<number>((s, v) => s + (v ?? 0), 0) : null);
  const typedPay = p ? ({ ...p, ...Object.fromEntries(PAYROLL_FIELDS.map((f) => [f.key, d.value[`p|${f.key}`] ?? null])) } as PayrollRow) : null;
  const split = typedPay ? payrollSplit(typedPay, anpmOverheads(typedRows).get(dept) ?? 0, data.rules) : null;
  const placeholder = (k: PayrollField) => (k === 'capPct' ? pctOf(rule.cap) : k === 'mjnhPct' ? pctOf(rule.mjnh) : k === 'asrePct' ? pctOf(rule.asre) : k === 'seniorCtc' && rule.asreWhole ? 'Whole department' : undefined);

  const save = () =>
    start(async () => {
      const changes: AdminChange[] = Object.entries(d.changes).map(([k, value]) => {
        const [kind, a, b] = k.split('|');
        return kind === 'p' ? { kind: 'payroll', dept, field: a as PayrollField, value: value ?? null } : { kind: 'admin', dept, account: a, entity: b, value: value ?? null };
      });
      const { ok, errors } = await send(versionId, changes);
      onSaved(ok);
      if (errors.length) setError(errors[0]);
      else {
        setError(null);
        d.reset();
      }
    });

  const shown = new Set(accounts);
  return (
    <RecordForm
      title={`${dept} · ${deptName(dept)}`}
      subtitle="Department · Finance"
      canEdit={canEditPay || canEditOh}
      dirty={d.dirty}
      saving={saving}
      error={error}
      onSave={save}
      onCancel={() => (d.reset(), setAccounts(initialRows.map((r) => r.account)), setError(null))}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
    >
      {p && typedPay && split && (
        <>
          <FormSection title={`Payroll ${year}B`} note="Totals from HR; a blank rule takes the department's default">
            <FormGrid>
              {PAYROLL_FIELDS.map((f) => (
                <FormField key={f.key} label={f.label}>
                  <NumIn value={d.value[`p|${f.key}`] ?? null} pct={f.kind === 'pct'} int={f.kind === 'int'} placeholder={placeholder(f.key)} enabled={canEditPay} changed={d.changed(`p|${f.key}`)} onChange={(n) => d.set(`p|${f.key}`, n)} />
                </FormField>
              ))}
            </FormGrid>
          </FormSection>
          <FormSection title="Under the 2026 rules" tone="calc" note="On payroll plus the overheads ANPM pays for the department">
            <FormGrid>
              <FormField label="Payroll">
                <Show right>{fmt(split.total)}</Show>
              </FormField>
              <FormField label="Overheads paid by ANPM">
                <Show right>{fmt(split.oh)}</Show>
              </FormField>
              <FormField label="Capitalised">
                <Show right>{fmt(-split.cap)}</Show>
              </FormField>
              <FormField label="To MJNH">
                <Show right>{fmt(-split.mjnh)}</Show>
              </FormField>
              <FormField label="To ASRE">
                <Show right>{fmt(-split.asre)}</Show>
              </FormField>
              <FormField label="Net in ANPM's G&A">
                <Show right>{fmt(split.net)}</Show>
              </FormField>
            </FormGrid>
          </FormSection>
        </>
      )}
      <FormSection title={`Admin overheads ${year}B`} note="One amount a year per account and paying company; schedule accounts come from their tabs">
        <FormTable
          head={['Account', `${year - 2}A`, `${year - 1}F`, ...PAYERS.map((y) => y.name), 'Total']}
          rows={typedRows.map((r) => ({
            key: r.account,
            cells: [
              <span key="n">
                {ADMIN_ACCOUNT.get(r.account)?.name ?? r.account} <span className="anh-code">{r.account}</span>
                {r.schedule && <span className="ml-1 text-[10px] text-slate-500">{ITEM_KIND.get(r.schedule)!.label} tab</span>}
              </span>,
              <Num key="a1" v={r.a1} />,
              <Num key="f" v={r.f} />,
              ...PAYERS.map((y) => {
                const k = `a|${r.account}|${y.code}`;
                return r.schedule || r.items[y.code] !== null || !canEditOh ? <Num key={y.code} v={cell(r, y.code)} /> : <NumIn key={y.code} value={d.value[k] ?? null} enabled changed={d.changed(k)} onChange={(n) => d.set(k, n)} />;
              }),
              <Num key="t" v={sum(PAYERS.map((y) => cell(r, y.code)))} />,
            ],
          }))}
          foot={['Total', <Num key="a1" v={sum(typedRows.map((r) => r.a1))} />, <Num key="f" v={sum(typedRows.map((r) => r.f))} />, ...PAYERS.map((y) => <Num key={y.code} v={sum(typedRows.map((r) => cell(r, y.code)))} />), <Num key="t" v={sum(typedRows.flatMap((r) => PAYERS.map((y) => cell(r, y.code))))} />]}
        />
        {canEditOh && (
          <div className="mt-2 max-w-md">
            <SelectIn
              value={null}
              enabled
              blank="+ Add account"
              options={ADMIN_ACCOUNTS.filter((a) => a.group !== 'Payroll' && !SCHEDULE_ACCOUNT.has(a.code) && !shown.has(a.code)).map((a) => ({ value: a.code, label: `${a.code} ${a.name} · ${a.group}` }))}
              onChange={(v) => v && setAccounts((x) => [...x, v])}
            />
          </div>
        )}
      </FormSection>
    </RecordForm>
  );
}

export function FeeForm({ row, prior, versionId, year, locked, onSaved, onClose, onPrev, onNext }: Nav & { row: FeeRow; prior: string | null }) {
  const d = useDraft({ base: row.base, rate: row.rate });
  const [saving, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fee = FEES.find((f) => f.key === row.fee)!;
  const who = FEE_ENTITIES.find((e) => e.key === row.entity)!.name;
  const amount = feeAmount({ ...row, ...d.value });
  return (
    <RecordForm
      title={`${fee.name} · ${who}`}
      subtitle={`Base: ${fee.base.toLowerCase()} · Finance`}
      canEdit={!locked}
      dirty={d.dirty}
      saving={saving}
      error={error}
      onSave={() =>
        start(async () => {
          const changes = (Object.keys(d.changes) as ('base' | 'rate')[]).map((field): AdminChange => ({ kind: 'fee', fee: row.fee, entity: row.entity, field, value: d.value[field] ?? null }));
          const { ok, errors } = await send(versionId, changes);
          onSaved(ok);
          if (errors.length) setError(errors[0]);
          else {
            setError(null);
            d.reset();
          }
        })
      }
      onCancel={() => (d.reset(), setError(null))}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
    >
      <FormSection title={`${year}B`} note="Blank takes the default">
        <FormGrid>
          <FormField label="Base" hint={row.defaultBase === null ? undefined : `Default ${fmt(row.defaultBase)}`}>
            <NumIn value={d.value.base} enabled={!locked} changed={d.changed('base')} placeholder={row.defaultBase === null ? undefined : fmt(row.defaultBase)} onChange={(n) => d.set('base', n)} />
          </FormField>
          <FormField label="Rate (%)" hint={`Default ${pctOf(row.defaultRate)}`}>
            <NumIn value={d.value.rate} pct enabled={!locked} changed={d.changed('rate')} placeholder={pctOf(row.defaultRate)} onChange={(n) => d.set('rate', n)} />
          </FormField>
          <FormField label="Fee">
            <Show right>{fmt(amount)}</Show>
          </FormField>
        </FormGrid>
      </FormSection>
      {prior && row.prior && (
        <FormSection title={prior} tone="fixed">
          <FormGrid>
            <FormField label="Base">
              <Show right>{fmt(row.prior.base)}</Show>
            </FormField>
            <FormField label="Rate">
              <Show right>{pctOf(row.prior.rate)}</Show>
            </FormField>
            <FormField label="Fee">
              <Show right>{fmt(row.prior.amount)}</Show>
            </FormField>
          </FormGrid>
        </FormSection>
      )}
    </RecordForm>
  );
}
