'use client';

// One building's overheads in the side form, as the Lease Budget's row form: last year fixed, the budget
// typed by its owner (property manager or Finance) with the month a lump sum is paid, saved together.

import { useState, useTransition } from 'react';
import { MONTHS } from '@/lib/format';
import { FormSection, FormTable, Num, NumIn, RecordForm, SelectIn, useDraft } from '@/components/record-form';
import { BOH_ACCOUNT, BOH_CALC_NOTE, paidInOneMonth, type BohBlock, type BohChange, type BohRow } from '@/lib/budget/boh-types';
import { saveBuildingOverheadCells } from './actions';

/** what the list shows after a save: the typed amount, the budget it gives, the month */
export function applyBohChange(r: BohRow, c: BohChange): BohRow {
  // municipal charges: last year's forecast until an amount is entered
  const byForecast = c.amount === null && r.calc === 'forecast';
  return { ...r, entered: c.amount, b: c.amount ?? (byForecast ? r.f : null), calc: byForecast ? 'forecast' : null, dueMonth: c.dueMonth };
}

export function BohForm({
  block,
  rows,
  year,
  locked,
  priorLabel,
  versionId,
  onSaved,
  onClose,
  onPrev,
  onNext,
}: {
  block: BohBlock;
  /** the accounts shown: with figures, or the user may enter them */
  rows: BohRow[];
  year: number;
  locked: boolean;
  priorLabel: string | null;
  versionId: number;
  onSaved: (changes: BohChange[]) => void;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const canEnter = (account: string) => !locked && (BOH_ACCOUNT.get(account)?.owner === 'FIN' ? block.finEditable : block.editable);
  const typed = (r: BohRow) => canEnter(r.account) && (r.calc === null || r.calc === 'forecast');
  const stored: Record<string, number | null> = {};
  for (const r of rows) if (typed(r)) Object.assign(stored, { [`${r.account}|a`]: r.entered, [`${r.account}|m`]: r.dueMonth });
  const d = useDraft(stored);
  const [saving, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canEdit = rows.some(typed);

  const save = () =>
    start(async () => {
      const accounts = [...new Set(Object.keys(d.changes).map((k) => k.split('|')[0]))];
      const ok: BohChange[] = [];
      const errors: string[] = [];
      for (const account of accounts) {
        const r = rows.find((x) => x.account === account)!;
        const amount = d.value[`${account}|a`] ?? null;
        const dueMonth = amount === null ? null : (d.value[`${account}|m`] ?? null);
        if (amount === null && r.calc === 'forecast' && d.changed(`${account}|m`)) {
          errors.push(`${BOH_ACCOUNT.get(account)?.name}: enter the amount first; while it follows last year's forecast it is paid in the month of last year's largest payment`);
          continue;
        }
        const c: BohChange = { propertyId: block.propertyId, account, amount, dueMonth };
        const res = await saveBuildingOverheadCells(versionId, [c]);
        if (res.errors.length) errors.push(...res.errors);
        else ok.push(c);
      }
      onSaved(ok);
      if (errors.length) setError(errors[0]);
      else {
        setError(null);
        d.reset();
      }
    });

  const phasing = (r: BohRow) => {
    const acct = BOH_ACCOUNT.get(r.account)!;
    if (r.calc === 'contracts') return 'Per contracts';
    if (!paidInOneMonth(acct)) return acct.phasing === 'seasonal' ? 'Seasonal' : 'Monthly';
    const prefix = acct.paidUpfront ? 'Monthly · paid ' : '';
    if (!typed(r)) return `${prefix}${MONTHS[(r.dueMonth ?? r.defaultDue) - 1]}`;
    const k = `${r.account}|m`;
    const v = d.value[k] ?? null;
    return (
      <SelectIn
        value={v === null ? null : String(v)}
        enabled
        changed={d.changed(k)}
        blank={`${prefix}${MONTHS[r.defaultDue - 1]} (as last year)`}
        options={MONTHS.map((m, i) => ({ value: String(i + 1), label: `${prefix}${m}` }))}
        onChange={(x) => d.set(k, x ? Number(x) : null)}
      />
    );
  };
  const sum = (f: (r: BohRow) => number | null | undefined) => {
    const vs = rows.map(f).filter((v): v is number => v !== null && v !== undefined);
    return vs.length ? vs.reduce((s, v) => s + v, 0) : null;
  };
  const budget = (r: BohRow) => {
    if (!typed(r)) return r.b;
    const a = d.value[`${r.account}|a`] ?? null;
    return a ?? (r.calc === 'forecast' ? r.f : null);
  };

  return (
    <RecordForm
      title={`${block.code} · ${block.name}`}
      subtitle={[block.buCode, block.pm].filter(Boolean).join(' · ')}
      canEdit={canEdit}
      dirty={d.dirty}
      saving={saving}
      error={error}
      onSave={save}
      onCancel={() => (d.reset(), setError(null))}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
    >
      <FormSection title="By account" note="Each account is entered by its owner; contract, insurance, watchmen and water & electricity lines are calculated">
        <FormTable
          head={['Account', `${year - 2}A`, `${year - 1}F`, ...(priorLabel ? [priorLabel] : []), `${year}B`, 'Phasing']}
          rows={rows.map((r) => {
            const a = BOH_ACCOUNT.get(r.account)!;
            const k = `${r.account}|a`;
            return {
              key: r.account,
              cells: [
                <span key="n" title={r.calc && r.calc !== 'forecast' ? BOH_CALC_NOTE[r.calc] : undefined}>
                  {a.name} <span className="anh-code">{a.code}</span>
                  <span className="ml-1 text-[10px] text-slate-500">{a.owner === 'PM' ? 'PM' : 'Finance'}</span>
                </span>,
                <Num key="a1" v={r.a1} />,
                <Num key="f" v={r.f} />,
                ...(priorLabel ? [<Num key="pb" v={r.pb ?? null} />] : []),
                typed(r) ? (
                  <NumIn key="b" value={d.value[k] ?? null} enabled changed={d.changed(k)} placeholder={r.calc === 'forecast' && r.f !== null ? String(r.f) : undefined} onChange={(n) => d.set(k, n)} />
                ) : (
                  <Num key="b" v={r.b} />
                ),
                <span key="p" className="block text-left">
                  {phasing(r)}
                </span>,
              ],
            };
          })}
          foot={['Total', <Num key="a1" v={sum((r) => r.a1)} />, <Num key="f" v={sum((r) => r.f)} />, ...(priorLabel ? [<Num key="pb" v={sum((r) => r.pb)} />] : []), <Num key="b" v={sum(budget)} />, '']}
        />
      </FormSection>
    </RecordForm>
  );
}
