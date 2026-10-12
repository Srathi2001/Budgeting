'use client';

// One property's (or a business unit's General) other income in the side form, as the Lease Budget's row
// form: the actuals fixed, the Oct–Dec forecast and the budget typed, saved together.

import { useState, useTransition } from 'react';
import { fmt } from '@/lib/format';
import { FormSection, FormTable, Num, NumIn, RecordForm, Show, useDraft } from '@/components/record-form';
import { OI_ACCOUNT, OI_ACCOUNTS, oiCell, oiInput, oiLabel, type OiBlock, type OiChange, type OiColumn, type OiPeriod } from '@/lib/budget/other-income-types';
import { saveOtherIncomeCells } from './actions';

const k = (account: string, period: OiPeriod) => `${account}|${period}`;

export function OiForm({
  block,
  columns,
  year,
  cutoff,
  locked,
  versionId,
  onSaved,
  onClose,
  onPrev,
  onNext,
}: {
  block: OiBlock;
  columns: OiColumn[];
  year: number;
  cutoff: number;
  locked: boolean;
  versionId: number;
  /** the changes the server took, to show them in the list */
  onSaved: (changes: OiChange[]) => void;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const canEdit = !locked && block.editable;
  // the accounts of this kind of row (General: company-level ones), and any other with figures
  const accounts = OI_ACCOUNTS.filter((a) => (block.kind === 'G' ? !!a.general : !a.general) || columns.some((c) => oiCell(block, a.code, c) !== null));
  const stored: Record<string, number | null> = {};
  for (const a of accounts) for (const p of ['OD', 'B'] as const) if (oiInput(block, a.code, p)) stored[k(a.code, p)] = block.values[a.code]?.[p] ?? null;
  const d = useDraft(stored);
  const [saving, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // the row as typed: F = YTD + OD, the change against last year's budget
  const value = (account: string, c: OiColumn): number | null => {
    const typed = (p: OiPeriod) => (k(account, p) in d.value ? d.value[k(account, p)] : (block.values[account]?.[p] ?? null));
    if (c === 'OD' || c === 'B') return oiInput(block, account, c) ? typed(c) : oiCell(block, account, c);
    if (c === 'F') {
      const ytd = oiCell(block, account, 'YTD');
      const od = typed('OD');
      return ytd === null && od === null ? null : (ytd ?? 0) + (od ?? 0);
    }
    if (c === 'CH') {
      const b = value(account, 'B');
      const pb = oiCell(block, account, 'PB');
      return b === null && pb === null ? null : (b ?? 0) - (pb ?? 0);
    }
    return oiCell(block, account, c);
  };
  const total = (c: OiColumn) => {
    const vs = accounts.map((a) => value(a.code, c)).filter((v): v is number => v !== null);
    return vs.length ? vs.reduce((s, v) => s + v, 0) : null;
  };

  const save = () =>
    start(async () => {
      const changes: OiChange[] = Object.entries(d.changes).map(([key, amount]) => {
        const [account, period] = key.split('|');
        return { scope: block.scope, account, period: period as OiPeriod, amount: amount ?? null };
      });
      // one at a time, so what was taken is shown even when one is refused
      const ok: OiChange[] = [];
      const errors: string[] = [];
      for (const c of changes) {
        const r = await saveOtherIncomeCells(versionId, [c]);
        if (r.errors.length) errors.push(...r.errors);
        else ok.push(c);
      }
      onSaved(ok);
      if (errors.length) setError(errors[0]);
      else {
        setError(null);
        d.reset();
      }
    });

  return (
    <RecordForm
      title={block.kind === 'G' ? `General · ${block.buCode} ${block.buName}` : `${block.code} · ${block.name}`}
      subtitle={[block.kind === 'G' ? 'Company level (Finance)' : block.buName, block.pm].filter(Boolean).join(' · ')}
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
      <FormSection title="By account" note={`Enter ${oiLabel('OD', year, cutoff)} and ${oiLabel('B', year, cutoff)}; blank is none`}>
        <FormTable
          head={['Account', ...columns.map((c) => oiLabel(c, year, cutoff))]}
          rows={accounts.map((a) => ({
            key: a.code,
            cells: [
              <span key="n">
                {a.name} <span className="anh-code">{a.code}</span>
              </span>,
              ...columns.map((c) => {
                if ((c === 'OD' || c === 'B') && canEdit && oiInput(block, a.code, c)) {
                  const key = k(a.code, c);
                  return <NumIn key={c} value={d.value[key] ?? null} enabled changed={d.changed(key)} onChange={(n) => d.set(key, n)} />;
                }
                return <Num key={c} v={value(a.code, c)} />;
              }),
            ],
          }))}
          foot={['Total', ...columns.map((c) => <Num key={c} v={total(c)} />)]}
        />
      </FormSection>
      {block.kind === 'P' && (
        <FormSection title="Calculated" tone="calc">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <span className="text-[11px] font-bold text-slate-900">{OI_ACCOUNT.get('52702')?.name}, from the Lease Budget</span>
            <Show right>{fmt(block.mfBudget)}</Show>
          </div>
        </FormSection>
      )}
    </RecordForm>
  );
}
