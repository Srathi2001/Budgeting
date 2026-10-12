'use client';

// Treasury: shareholder loans, fixed deposits and contingencies, entered by Finance. Each tab is the list on
// the left and the record's side form on the right (as the Lease Budget); the figures of the year are
// worked out as you type (treasury-calc.ts) and reach the P&L, cash flow and later the balance sheet.

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { fmt, MONTHS } from '@/lib/format';
import { CheckIn, DateIn, FormField, FormGrid, FormSection, NumIn, RecordForm, SelectIn, Show, TextIn, useDraft } from '@/components/record-form';
import { contingencyMonths, depositYear, loanYear, DAY_BASES, FREQUENCIES, REPAYMENT_LABEL, REPAYMENT_TYPES } from '@/lib/budget/treasury-calc';
import { deleteTreasuryRecord, saveTreasuryRecord } from './actions';

type Opt = { value: string; label: string };
interface Common {
  versionId: number;
  year: number;
  canEdit: boolean;
  entities: Opt[];
}
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const dmy = (v: string | null) => (v ? new Date(`${v}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/ /g, '-') : '');
const pctText = (v: number) => `${Math.round(v * 1e6) / 1e4}%`;
const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x }));

/** the list and the side form of one tab */
function Layout({ head, list, form }: { head: ReactNode; list: ReactNode; form: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 space-y-3 overflow-auto p-6">
        <div className="flex flex-wrap items-center gap-2">{head}</div>
        <div className="anh-grid-wrap">{list}</div>
      </div>
      {form}
    </div>
  );
}

/** selection over the list: a record, a new one, or none; ↑ ↓ */
function useSelection<T extends { id: number }>(rows: T[]) {
  const [sel, setSel] = useState<number | 'new' | null>(null);
  const idx = typeof sel === 'number' ? rows.findIndex((r) => r.id === sel) : -1;
  return {
    sel,
    setSel,
    current: typeof sel === 'number' ? (rows.find((r) => r.id === sel) ?? null) : null,
    prev: idx > 0 ? () => setSel(rows[idx - 1].id) : undefined,
    next: idx >= 0 && idx < rows.length - 1 ? () => setSel(rows[idx + 1].id) : undefined,
  };
}

/** save / delete of a record, then the page reloads its figures */
function useSave(versionId: number, kind: 'loan' | 'deposit' | 'contingency', done: () => void) {
  const router = useRouter();
  const [saving, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return {
    saving,
    error,
    setError,
    save: (input: unknown, after: () => void) =>
      start(async () => {
        const r = await saveTreasuryRecord(versionId, kind, input);
        if (r.error) return setError(r.error);
        setError(null);
        after();
        router.refresh();
      }),
    remove: (id: number | null) =>
      start(async () => {
        if (id === null) return done();
        const r = await deleteTreasuryRecord(versionId, kind, id);
        if (r.error) return setError(r.error);
        done();
        router.refresh();
      }),
  };
}

// ---- shareholder loans -------------------------------------------------------------------------------

export interface LoanRow {
  id: number;
  name: string;
  lender: string | null;
  entity: string;
  principal: number | null;
  openingBalance: number;
  rate: number;
  dayBasis: string;
  interestFrequency: string;
  firstInterestDate: string | null;
  repaymentType: string;
  repaymentFrequency: string;
  firstRepaymentDate: string | null;
  maturityDate: string | null;
  capitalisePct: number;
  capitaliseProject: string | null;
  contributionLagMonths: number | null;
  notes: string | null;
  events: { date: string; kind: string; amount: number }[];
}
type LoanDraft = Omit<LoanRow, 'id'> & { id: number | null };
const loanYearOf = (l: LoanDraft, year: number) => loanYear({ ...l, openingBalance: Number(l.openingBalance) || 0, rate: Number(l.rate) || 0, capitalisePct: Number(l.capitalisePct) || 0 }, l.events.map((e) => ({ ...e, amount: Number(e.amount) })), year);

export function LoansTab({ rows, versionId, year, canEdit, entities }: Common & { rows: LoanRow[] }) {
  const s = useSelection(rows);
  const blank: LoanDraft = {
    id: null, name: '', lender: null, entity: entities[0]?.value ?? '501', principal: null, openingBalance: 0, rate: 0, dayBasis: 'ACT/365', interestFrequency: 'Quarterly', firstInterestDate: null,
    repaymentType: 'EQUAL_PRINCIPAL', repaymentFrequency: 'Quarterly', firstRepaymentDate: null, maturityDate: null, capitalisePct: 0, capitaliseProject: null, contributionLagMonths: null, notes: null, events: [],
  };
  const current: LoanDraft | null = s.sel === 'new' ? blank : s.current;
  const ys = rows.map((r) => ({ r, y: loanYearOf(r, year) }));
  return (
    <Layout
      head={
        <>
          <h2 className="mr-2 text-sm font-bold">Shareholder loans · {year}B</h2>
          {canEdit && (
            <button className="btn" onClick={() => s.setSel('new')}>
              + Add loan
            </button>
          )}
          <span className="text-xs text-slate-500">Interest below EBITDA of the borrowing entity; interest and principal paid in the cash flow</span>
        </>
      }
      list={
        <table className="anh-grid w-full">
          <thead>
            <tr className="h1">
              <th>Loan</th>
              <th>Entity</th>
              <th className="anh-num">Balance 1-Jan</th>
              <th className="anh-num">Rate</th>
              <th className="anh-num">Interest {year}</th>
              <th className="anh-num">Repaid {year}</th>
              <th className="anh-num">Balance 31-Dec</th>
            </tr>
          </thead>
          <tbody>
            {ys.map(({ r, y }) => (
              <tr key={r.id} className={`child cursor-pointer ${s.sel === r.id ? 'is-selected' : ''}`} onClick={() => s.setSel(r.id)}>
                <td>
                  {r.name}
                  {r.lender && <span className="ml-1 text-slate-500">· {r.lender}</span>}
                </td>
                <td>{r.entity}</td>
                <td className="anh-num">{fmt(r.openingBalance)}</td>
                <td className="anh-num">{pctText(Number(r.rate))}</td>
                <td className="anh-num calc">{fmt(sum(y.interestExpense))}</td>
                <td className="anh-num calc">{fmt(sum(y.principalRepaid))}</td>
                <td className="anh-num calc">{fmt(y.closing[11])}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="is-empty">
                  No loans yet. Finance adds them here (the balances can later come from the trial balance).
                </td>
              </tr>
            )}
            {rows.length > 0 && (
              <tr className="total">
                <td colSpan={2}>Total</td>
                <td className="anh-num">{fmt(sum(rows.map((r) => Number(r.openingBalance))))}</td>
                <td />
                <td className="anh-num">{fmt(sum(ys.map(({ y }) => sum(y.interestExpense))))}</td>
                <td className="anh-num">{fmt(sum(ys.map(({ y }) => sum(y.principalRepaid))))}</td>
                <td className="anh-num">{fmt(sum(ys.map(({ y }) => y.closing[11])))}</td>
              </tr>
            )}
          </tbody>
        </table>
      }
      form={current && <LoanForm key={current.id ?? 'new'} record={current} year={year} canEdit={canEdit} versionId={versionId} entities={entities} onClose={() => s.setSel(null)} onPrev={s.prev} onNext={s.next} />}
    />
  );
}

function LoanForm({ record, year, canEdit, versionId, entities, onClose, onPrev, onNext }: { record: LoanDraft; year: number; canEdit: boolean; versionId: number; entities: Opt[]; onClose: () => void; onPrev?: () => void; onNext?: () => void }) {
  const d = useDraft(record);
  const v = d.value;
  const x = useSave(versionId, 'loan', onClose);
  const y = loanYearOf(v, year);
  const custom = v.repaymentType === 'CUSTOM';
  const setEvent = (i: number, patch: Partial<LoanRow['events'][number]>) => d.set('events', v.events.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  return (
    <RecordForm
      title={v.name || 'New loan'}
      history={record.id !== null ? { entity: 'shareholder_loan', entityId: String(record.id) } : undefined}
      subtitle={`${v.entity}${v.lender ? ` · ${v.lender}` : ''}`}
      canEdit={canEdit}
      dirty={v.id === null ? Math.max(d.dirty, 1) : d.dirty}
      saving={x.saving}
      error={x.error}
      onSave={() => (v.name.trim() ? x.save({ ...v, seen: record }, () => (d.reset(), v.id === null && onClose())) : x.setError('Give the loan a name'))}
      onCancel={() => (d.reset(), x.setError(null))}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      onDelete={() => x.remove(v.id)}
      deleteLabel={v.id === null ? 'Discard' : 'Delete this loan'}
    >
      <FormSection title="Loan">
        <FormGrid>
          <FormField label="Name">
            <TextIn value={v.name || null} enabled={canEdit} changed={d.changed('name')} onChange={(t) => d.set('name', t ?? '')} />
          </FormField>
          <FormField label="Lender">
            <TextIn value={v.lender} enabled={canEdit} changed={d.changed('lender')} onChange={(t) => d.set('lender', t)} />
          </FormField>
          <FormField label="Borrowing entity" hint="Its P&L and cash flow carry the loan">
            <SelectIn value={v.entity} enabled={canEdit} changed={d.changed('entity')} options={entities} onChange={(t) => t && d.set('entity', t)} />
          </FormField>
          <FormField label="Principal (facility)">
            <NumIn value={v.principal} enabled={canEdit} changed={d.changed('principal')} onChange={(n) => d.set('principal', n)} />
          </FormField>
        </FormGrid>
      </FormSection>
      <FormSection title="Balance and interest">
        <FormGrid>
          <FormField label={`Balance at 1-Jan-${year}`}>
            <NumIn value={v.openingBalance} enabled={canEdit} changed={d.changed('openingBalance')} onChange={(n) => d.set('openingBalance', n ?? 0)} />
          </FormField>
          <FormField label="Interest rate a year (%)">
            <NumIn value={v.rate} pct enabled={canEdit} changed={d.changed('rate')} onChange={(n) => d.set('rate', n ?? 0)} />
          </FormField>
          <FormField label="Day basis">
            <SelectIn value={v.dayBasis} enabled={canEdit} changed={d.changed('dayBasis')} options={opts(DAY_BASES)} onChange={(t) => t && d.set('dayBasis', t)} />
          </FormField>
          <FormField label="Interest paid">
            <SelectIn value={v.interestFrequency} enabled={canEdit} changed={d.changed('interestFrequency')} options={opts(FREQUENCIES)} onChange={(t) => t && d.set('interestFrequency', t)} />
          </FormField>
          <FormField label="First interest date">
            <DateIn value={v.firstInterestDate} enabled={canEdit} changed={d.changed('firstInterestDate')} onChange={(t) => d.set('firstInterestDate', t)} />
          </FormField>
        </FormGrid>
      </FormSection>
      <FormSection title="Repayment">
        <FormGrid>
          <FormField label="Repaid as">
            <SelectIn value={v.repaymentType} enabled={canEdit} changed={d.changed('repaymentType')} options={REPAYMENT_TYPES.map((t) => ({ value: t, label: REPAYMENT_LABEL[t] }))} onChange={(t) => t && d.set('repaymentType', t)} />
          </FormField>
          {!custom && v.repaymentType !== 'BULLET' && (
            <>
              <FormField label="Every">
                <SelectIn value={v.repaymentFrequency} enabled={canEdit} changed={d.changed('repaymentFrequency')} options={opts(FREQUENCIES)} onChange={(t) => t && d.set('repaymentFrequency', t)} />
              </FormField>
              <FormField label="First repayment">
                <DateIn value={v.firstRepaymentDate} enabled={canEdit} changed={d.changed('firstRepaymentDate')} onChange={(t) => d.set('firstRepaymentDate', t)} />
              </FormField>
            </>
          )}
          <FormField label="Maturity">
            <DateIn value={v.maturityDate} enabled={canEdit} changed={d.changed('maturityDate')} onChange={(t) => d.set('maturityDate', t)} />
          </FormField>
        </FormGrid>
        <div className="mt-3 space-y-1">
          <div className="text-[11px] font-bold text-slate-900">{custom ? 'Drawdowns and repayments' : 'Drawdowns'}</div>
          <table className="anh-grid">
            <tbody>
              {v.events.map((e, i) => (
                <tr key={i} className="child">
                  <td className="input">{canEdit ? <input type="date" value={e.date} onChange={(ev) => setEvent(i, { date: ev.target.value })} aria-label="Date" /> : dmy(e.date)}</td>
                  <td className="input">
                    {canEdit ? (
                      <select value={e.kind} onChange={(ev) => setEvent(i, { kind: ev.target.value })} aria-label="Kind">
                        <option value="DRAWDOWN">Drawdown</option>
                        {custom && <option value="REPAYMENT">Repayment</option>}
                      </select>
                    ) : e.kind === 'DRAWDOWN' ? 'Drawdown' : 'Repayment'}
                  </td>
                  <td className="anh-num input">{canEdit ? <input inputMode="decimal" value={String(e.amount)} onChange={(ev) => setEvent(i, { amount: Number(ev.target.value.replace(/,/g, '')) || 0 })} aria-label="Amount" /> : fmt(e.amount)}</td>
                  {canEdit && (
                    <td>
                      <button className="btn btn-xs" onClick={() => d.set('events', v.events.filter((_, j) => j !== i))}>
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit && (
            <button className="btn btn-xs" onClick={() => d.set('events', [...v.events, { date: `${year}-01-01`, kind: custom ? 'REPAYMENT' : 'DRAWDOWN', amount: 0 }])}>
              + Add {custom ? 'a drawdown or repayment' : 'a drawdown'}
            </button>
          )}
        </div>
      </FormSection>
      <FormSection title="Capitalised interest and contributions">
        <FormGrid>
          <FormField label="Interest capitalised (%)" hint="Added to the project, not the P&L">
            <NumIn value={v.capitalisePct} pct enabled={canEdit} changed={d.changed('capitalisePct')} onChange={(n) => d.set('capitalisePct', n ?? 0)} />
          </FormField>
          <FormField label="Project">
            <TextIn value={v.capitaliseProject} enabled={canEdit} changed={d.changed('capitaliseProject')} onChange={(t) => d.set('capitaliseProject', t)} />
          </FormField>
          <FormField label="Repayments come back as a contribution after (months)" hint="Blank: they don't (2026: 1 month)">
            <NumIn value={v.contributionLagMonths} int enabled={canEdit} changed={d.changed('contributionLagMonths')} onChange={(n) => d.set('contributionLagMonths', n)} />
          </FormField>
        </FormGrid>
      </FormSection>
      <FormSection title={`Result ${year}`} tone="calc" note="Recalculated as you type">
        <FormGrid>
          <FormField label="Interest in the P&L">
            <Show right>{fmt(sum(y.interestExpense))}</Show>
          </FormField>
          <FormField label="Interest capitalised">
            <Show right>{fmt(sum(y.interestCapitalised))}</Show>
          </FormField>
          <FormField label="Interest paid">
            <Show right>{fmt(sum(y.interestPaid))}</Show>
          </FormField>
          <FormField label="Drawn">
            <Show right>{fmt(sum(y.drawdowns))}</Show>
          </FormField>
          <FormField label="Principal repaid">
            <Show right>{fmt(sum(y.principalRepaid))}</Show>
          </FormField>
          <FormField label="Contributions back">
            <Show right>{fmt(sum(y.contributions))}</Show>
          </FormField>
          <FormField label={`Balance 31-Dec-${year}`}>
            <Show right>{fmt(y.closing[11])}</Show>
          </FormField>
        </FormGrid>
      </FormSection>
      <FormSection title="Notes">
        <TextIn value={v.notes} enabled={canEdit} changed={d.changed('notes')} onChange={(t) => d.set('notes', t)} />
      </FormSection>
    </RecordForm>
  );
}

// ---- fixed deposits ---------------------------------------------------------------------------------

export interface DepositRow {
  id: number;
  bank: string;
  reference: string | null;
  entity: string;
  amount: number;
  placementDate: string | null;
  maturityDate: string | null;
  rate: number;
  dayBasis: string;
  interestPayout: string;
  rollover: boolean;
  rolloverRate: number | null;
  notes: string | null;
}
type DepositDraft = Omit<DepositRow, 'id'> & { id: number | null };
const PAYOUT = [
  { value: 'MATURITY', label: 'At maturity' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
];
const depYear = (r: DepositDraft, year: number) => depositYear({ ...r, amount: Number(r.amount) || 0, rate: Number(r.rate) || 0, rolloverRate: r.rolloverRate === null ? null : Number(r.rolloverRate) }, year);

export function DepositsTab({ rows, versionId, year, canEdit, entities }: Common & { rows: DepositRow[] }) {
  const s = useSelection(rows);
  const blank: DepositDraft = { id: null, bank: '', reference: null, entity: entities[0]?.value ?? '501', amount: 0, placementDate: `${year}-01-01`, maturityDate: null, rate: 0, dayBasis: 'ACT/365', interestPayout: 'MATURITY', rollover: false, rolloverRate: null, notes: null };
  const current: DepositDraft | null = s.sel === 'new' ? blank : s.current;
  const ys = rows.map((r) => ({ r, y: depYear(r, year) }));
  return (
    <Layout
      head={
        <>
          <h2 className="mr-2 text-sm font-bold">Fixed deposits · {year}B</h2>
          {canEdit && (
            <button className="btn" onClick={() => s.setSel('new')}>
              + Add deposit
            </button>
          )}
          <span className="text-xs text-slate-500">Interest is the entity&apos;s other income (52201), in place of the figure typed before; placements and maturities in the cash flow</span>
        </>
      }
      list={
        <table className="anh-grid w-full">
          <thead>
            <tr className="h1">
              <th>Bank</th>
              <th>Entity</th>
              <th className="anh-num">Amount</th>
              <th className="anh-num">Rate</th>
              <th>Placed</th>
              <th>Matures</th>
              <th className="anh-num">Interest {year}</th>
              <th className="anh-num">31-Dec</th>
            </tr>
          </thead>
          <tbody>
            {ys.map(({ r, y }) => (
              <tr key={r.id} className={`child cursor-pointer ${s.sel === r.id ? 'is-selected' : ''}`} onClick={() => s.setSel(r.id)}>
                <td>
                  {r.bank}
                  {r.reference && <span className="ml-1 text-slate-500">· {r.reference}</span>}
                </td>
                <td>{r.entity}</td>
                <td className="anh-num">{fmt(r.amount)}</td>
                <td className="anh-num">{pctText(Number(r.rate))}</td>
                <td>{dmy(r.placementDate)}</td>
                <td>
                  {dmy(r.maturityDate)}
                  {r.rollover && ' · rolls over'}
                </td>
                <td className="anh-num calc">{fmt(sum(y.interest))}</td>
                <td className="anh-num calc">{fmt(y.closing[11])}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="is-empty">
                  No deposits yet. Finance adds them here (they can later come from the trial balance).
                </td>
              </tr>
            )}
            {rows.length > 0 && (
              <tr className="total">
                <td colSpan={2}>Total</td>
                <td className="anh-num">{fmt(sum(rows.map((r) => Number(r.amount))))}</td>
                <td colSpan={3} />
                <td className="anh-num">{fmt(sum(ys.map(({ y }) => sum(y.interest))))}</td>
                <td className="anh-num">{fmt(sum(ys.map(({ y }) => y.closing[11])))}</td>
              </tr>
            )}
          </tbody>
        </table>
      }
      form={current && <DepositForm key={current.id ?? 'new'} record={current} year={year} canEdit={canEdit} versionId={versionId} entities={entities} onClose={() => s.setSel(null)} onPrev={s.prev} onNext={s.next} />}
    />
  );
}

function DepositForm({ record, year, canEdit, versionId, entities, onClose, onPrev, onNext }: { record: DepositDraft; year: number; canEdit: boolean; versionId: number; entities: Opt[]; onClose: () => void; onPrev?: () => void; onNext?: () => void }) {
  const d = useDraft(record);
  const v = d.value;
  const x = useSave(versionId, 'deposit', onClose);
  const y = depYear(v, year);
  return (
    <RecordForm
      title={v.bank || 'New deposit'}
      history={record.id !== null ? { entity: 'fixed_deposit', entityId: String(record.id) } : undefined}
      subtitle={`${v.entity}${v.reference ? ` · ${v.reference}` : ''}`}
      canEdit={canEdit}
      dirty={v.id === null ? Math.max(d.dirty, 1) : d.dirty}
      saving={x.saving}
      error={x.error}
      onSave={() => (v.bank.trim() ? x.save({ ...v, seen: record }, () => (d.reset(), v.id === null && onClose())) : x.setError('Enter the bank'))}
      onCancel={() => (d.reset(), x.setError(null))}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      onDelete={() => x.remove(v.id)}
      deleteLabel={v.id === null ? 'Discard' : 'Delete this deposit'}
    >
      <FormSection title="Deposit">
        <FormGrid>
          <FormField label="Bank">
            <TextIn value={v.bank || null} enabled={canEdit} changed={d.changed('bank')} onChange={(t) => d.set('bank', t ?? '')} />
          </FormField>
          <FormField label="Reference">
            <TextIn value={v.reference} enabled={canEdit} changed={d.changed('reference')} onChange={(t) => d.set('reference', t)} />
          </FormField>
          <FormField label="Entity">
            <SelectIn value={v.entity} enabled={canEdit} changed={d.changed('entity')} options={entities} onChange={(t) => t && d.set('entity', t)} />
          </FormField>
        </FormGrid>
      </FormSection>
      <FormSection title="Terms">
        <FormGrid>
          <FormField label="Amount">
            <NumIn value={v.amount} enabled={canEdit} changed={d.changed('amount')} onChange={(n) => d.set('amount', n ?? 0)} />
          </FormField>
          <FormField label="Placed on">
            <DateIn value={v.placementDate} enabled={canEdit} changed={d.changed('placementDate')} onChange={(t) => d.set('placementDate', t)} />
          </FormField>
          <FormField label="Matures on" hint="Blank: open-ended">
            <DateIn value={v.maturityDate} enabled={canEdit} changed={d.changed('maturityDate')} onChange={(t) => d.set('maturityDate', t)} />
          </FormField>
          <FormField label="Rate a year (%)">
            <NumIn value={v.rate} pct enabled={canEdit} changed={d.changed('rate')} onChange={(n) => d.set('rate', n ?? 0)} />
          </FormField>
          <FormField label="Day basis">
            <SelectIn value={v.dayBasis} enabled={canEdit} changed={d.changed('dayBasis')} options={opts(DAY_BASES)} onChange={(t) => t && d.set('dayBasis', t)} />
          </FormField>
          <FormField label="Interest paid">
            <SelectIn value={v.interestPayout} enabled={canEdit} changed={d.changed('interestPayout')} options={PAYOUT} onChange={(t) => t && d.set('interestPayout', t)} />
          </FormField>
          <FormField label="At maturity">
            <CheckIn value={v.rollover} enabled={canEdit} onChange={(b) => d.set('rollover', b)} label="Placed again for the same term" />
          </FormField>
          {v.rollover && (
            <FormField label="New rate (%)" hint="Blank: the same rate">
              <NumIn value={v.rolloverRate} pct enabled={canEdit} changed={d.changed('rolloverRate')} onChange={(n) => d.set('rolloverRate', n)} />
            </FormField>
          )}
        </FormGrid>
      </FormSection>
      <FormSection title={`Result ${year}`} tone="calc" note="Recalculated as you type">
        <FormGrid>
          <FormField label="Interest income">
            <Show right>{fmt(sum(y.interest))}</Show>
          </FormField>
          <FormField label="Interest received">
            <Show right>{fmt(sum(y.interestReceived))}</Show>
          </FormField>
          <FormField label="Placed (cash out)">
            <Show right>{fmt(sum(y.placed))}</Show>
          </FormField>
          <FormField label="Matured (cash in)">
            <Show right>{fmt(sum(y.matured))}</Show>
          </FormField>
          <FormField label={`Balance 31-Dec-${year}`}>
            <Show right>{fmt(y.closing[11])}</Show>
          </FormField>
        </FormGrid>
      </FormSection>
      <FormSection title="Notes">
        <TextIn value={v.notes} enabled={canEdit} changed={d.changed('notes')} onChange={(t) => d.set('notes', t)} />
      </FormSection>
    </RecordForm>
  );
}

// ---- contingencies ----------------------------------------------------------------------------------

export interface ContingencyRow {
  id: number;
  entity: string;
  description: string;
  category: string | null;
  amount: number;
  phasing: string;
  month: number | null;
  cash: boolean;
  notes: string | null;
}
type ContingencyDraft = Omit<ContingencyRow, 'id'> & { id: number | null };

export function ContingenciesTab({ rows, versionId, year, canEdit, entities }: Common & { rows: ContingencyRow[] }) {
  const s = useSelection(rows);
  const blank: ContingencyDraft = { id: null, entity: entities[0]?.value ?? '501', description: '', category: null, amount: 0, phasing: 'EVEN', month: null, cash: true, notes: null };
  const current: ContingencyDraft | null = s.sel === 'new' ? blank : s.current;
  return (
    <Layout
      head={
        <>
          <h2 className="mr-2 text-sm font-bold">Contingencies · {year}B</h2>
          {canEdit && (
            <button className="btn" onClick={() => s.setSel('new')}>
              + Add contingency
            </button>
          )}
          <span className="text-xs text-slate-500">Below EBITDA, as the 2026 budget (REHL 0.5M, ANPM 0.2M)</span>
        </>
      }
      list={
        <table className="anh-grid w-full">
          <thead>
            <tr className="h1">
              <th>Description</th>
              <th>Entity</th>
              <th>Category</th>
              <th>Phasing</th>
              <th>Paid</th>
              <th className="anh-num">{year}B</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`child cursor-pointer ${s.sel === r.id ? 'is-selected' : ''}`} onClick={() => s.setSel(r.id)}>
                <td>{r.description}</td>
                <td>{r.entity}</td>
                <td>{r.category ?? ''}</td>
                <td>{r.phasing === 'MONTH' && r.month ? MONTHS[r.month - 1] : 'Evenly'}</td>
                <td>{r.cash ? 'Yes' : 'Provision only'}</td>
                <td className="anh-num">{fmt(r.amount)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="is-empty">
                  No contingencies yet.
                </td>
              </tr>
            )}
            {rows.length > 0 && (
              <tr className="total">
                <td colSpan={5}>Total</td>
                <td className="anh-num">{fmt(sum(rows.map((r) => Number(r.amount))))}</td>
              </tr>
            )}
          </tbody>
        </table>
      }
      form={current && <ContingencyForm key={current.id ?? 'new'} record={current} year={year} canEdit={canEdit} versionId={versionId} entities={entities} onClose={() => s.setSel(null)} onPrev={s.prev} onNext={s.next} />}
    />
  );
}

function ContingencyForm({ record, year, canEdit, versionId, entities, onClose, onPrev, onNext }: { record: ContingencyDraft; year: number; canEdit: boolean; versionId: number; entities: Opt[]; onClose: () => void; onPrev?: () => void; onNext?: () => void }) {
  const d = useDraft(record);
  const v = d.value;
  const x = useSave(versionId, 'contingency', onClose);
  const months = contingencyMonths({ amount: Number(v.amount) || 0, phasing: v.phasing, month: v.month });
  return (
    <RecordForm
      title={v.description || 'New contingency'}
      history={record.id !== null ? { entity: 'contingency', entityId: String(record.id) } : undefined}
      subtitle={v.entity}
      canEdit={canEdit}
      dirty={v.id === null ? Math.max(d.dirty, 1) : d.dirty}
      saving={x.saving}
      error={x.error}
      onSave={() => (v.description.trim() ? x.save({ ...v, seen: record }, () => (d.reset(), v.id === null && onClose())) : x.setError('Describe the contingency'))}
      onCancel={() => (d.reset(), x.setError(null))}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      onDelete={() => x.remove(v.id)}
      deleteLabel={v.id === null ? 'Discard' : 'Delete'}
    >
      <FormSection title="Contingency">
        <FormGrid>
          <FormField label="Description" wide>
            <TextIn value={v.description || null} enabled={canEdit} changed={d.changed('description')} onChange={(t) => d.set('description', t ?? '')} />
          </FormField>
          <FormField label="Entity">
            <SelectIn value={v.entity} enabled={canEdit} changed={d.changed('entity')} options={entities} onChange={(t) => t && d.set('entity', t)} />
          </FormField>
          <FormField label="Category">
            <TextIn value={v.category} enabled={canEdit} changed={d.changed('category')} onChange={(t) => d.set('category', t)} />
          </FormField>
          <FormField label={`Amount ${year}`}>
            <NumIn value={v.amount} enabled={canEdit} changed={d.changed('amount')} onChange={(n) => d.set('amount', n ?? 0)} />
          </FormField>
          <FormField label="Phasing">
            <SelectIn value={v.phasing} enabled={canEdit} changed={d.changed('phasing')} options={[{ value: 'EVEN', label: 'Evenly over the year' }, { value: 'MONTH', label: 'In one month' }]} onChange={(t) => t && d.set('phasing', t)} />
          </FormField>
          {v.phasing === 'MONTH' && (
            <FormField label="Month">
              <SelectIn value={v.month === null ? null : String(v.month)} enabled={canEdit} changed={d.changed('month')} blank="Choose" options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} onChange={(t) => d.set('month', t ? Number(t) : null)} />
            </FormField>
          )}
          <FormField label="Cash">
            <CheckIn value={v.cash} enabled={canEdit} onChange={(b) => d.set('cash', b)} label="Expected to be paid (cash flow)" />
          </FormField>
        </FormGrid>
      </FormSection>
      <FormSection title={`Result ${year}`} tone="calc">
        <Show right>{fmt(sum(months))}</Show>
      </FormSection>
      <FormSection title="Notes">
        <TextIn value={v.notes} enabled={canEdit} changed={d.changed('notes')} onChange={(t) => d.set('notes', t)} />
      </FormSection>
    </RecordForm>
  );
}
