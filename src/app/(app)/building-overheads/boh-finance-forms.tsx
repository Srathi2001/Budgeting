'use client';

// Finance's building inputs in the side form, as the Lease Budget's row form: the insurance base of a
// building (Assumptions tab) and its watchmen (Security allocation tab).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fmt } from '@/lib/format';
import { FormField, FormGrid, FormSection, NumIn, RecordForm, Show, useDraft } from '@/components/record-form';
import { parBudget, plBudget, watchmenBudget } from '@/lib/budget/boh-calc';
import type { BohBlock } from '@/lib/budget/boh-types';
import type { InsuranceRow } from '@/lib/budget/boh-schedules';
import { saveInsurance, saveWatchmen } from './actions';

// the building open in each form, kept while the tab reloads after a save
const openNow: { insurance: number | null; watchmen: number | null } = { insurance: null, watchmen: null };
export function useOpen(which: keyof typeof openNow) {
  const [open, setOpenState] = useState<number | null>(openNow[which]);
  return [open, (id: number | null) => ((openNow[which] = id), setOpenState(id))] as const;
}

interface Nav {
  block: BohBlock;
  year: number;
  canEdit: boolean;
  versionId: number;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}
const f = (b: BohBlock, account: string) => b.rows.find((r) => r.account === account)?.f ?? null;

export function InsuranceForm({ block, year, canEdit, versionId, onClose, onPrev, onNext, insurance, parPct, plPct }: Nav & { insurance: InsuranceRow | undefined; parPct: number; plPct: number }) {
  const router = useRouter();
  const d = useDraft({ insuredValue: insurance?.insuredValue ?? null, parRate: insurance?.parRate ?? null, plPremium: insurance?.plPremium ?? null });
  const v = d.value;
  const [saving, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const par = parBudget(v.insuredValue, v.parRate, parPct);
  const pl = plBudget(v.plPremium, plPct);
  const last = (f(block, '64601') ?? 0) + (f(block, '64604') ?? 0);
  return (
    <RecordForm
      title={`${block.code} · ${block.name}`}
      subtitle={`Insurance · ${block.buCode}`}
      canEdit={canEdit}
      dirty={d.dirty}
      saving={saving}
      error={error}
      onSave={() =>
        start(async () => {
          const r = await saveInsurance(versionId, [{ propertyId: block.propertyId, ...v }]);
          if (r.error) return setError(r.error);
          setError(null);
          router.refresh();
        })
      }
      onCancel={() => (d.reset(), setError(null))}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
    >
      <FormSection title={`Base (${year - 1})`}>
        <FormGrid>
          <FormField label="Insured value">
            <NumIn value={v.insuredValue} enabled={canEdit} changed={d.changed('insuredValue')} onChange={(n) => d.set('insuredValue', n)} />
          </FormField>
          <FormField label={`PAR rate ${year - 1} (%)`}>
            <NumIn value={v.parRate} pct enabled={canEdit} changed={d.changed('parRate')} onChange={(n) => d.set('parRate', n)} />
          </FormField>
          <FormField label={`Public liability premium ${year - 1}`}>
            <NumIn value={v.plPremium} enabled={canEdit} changed={d.changed('plPremium')} onChange={(n) => d.set('plPremium', n)} />
          </FormField>
        </FormGrid>
      </FormSection>
      <FormSection title={`Result ${year}B`} tone="calc" note={`PAR + ${Math.round(parPct * 1e4) / 100}%, liability + ${Math.round(plPct * 1e4) / 100}% (Assumptions)`}>
        <FormGrid>
          <FormField label="PAR">
            <Show right>{fmt(par)}</Show>
          </FormField>
          <FormField label="Public liability">
            <Show right>{fmt(pl)}</Show>
          </FormField>
          <FormField label="Insurance">
            <Show right>{fmt((par ?? 0) + (pl ?? 0))}</Show>
          </FormField>
          <FormField label={`PAR + liability ${year - 1}F`}>
            <Show right>{fmt(last || null)}</Show>
          </FormField>
        </FormGrid>
      </FormSection>
    </RecordForm>
  );
}

export function WatchmenForm({ block, year, canEdit, versionId, onClose, onPrev, onNext, share, cost }: Nav & { share: number | null; cost: number }) {
  const router = useRouter();
  const d = useDraft({ share });
  const [saving, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const r = block.rows.find((x) => x.account === '62603');
  return (
    <RecordForm
      title={`${block.code} · ${block.name}`}
      subtitle={`Security allocation · ${block.buCode}`}
      canEdit={canEdit}
      dirty={d.dirty}
      saving={saving}
      error={error}
      onSave={() =>
        start(async () => {
          const res = await saveWatchmen(versionId, [{ propertyId: block.propertyId, share: d.value.share }]);
          if (res.error) return setError(res.error);
          setError(null);
          router.refresh();
        })
      }
      onCancel={() => (d.reset(), setError(null))}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
    >
      <FormSection title="Watchmen">
        <FormGrid>
          <FormField label="Watchmen (share of one)" hint="0.5 = half a watchman's time">
            <NumIn value={d.value.share} enabled={canEdit} changed={d.changed('share')} onChange={(n) => d.set('share', n)} />
          </FormField>
          <FormField label="Cost per watchman a year">
            <Show right>{fmt(cost)}</Show>
          </FormField>
        </FormGrid>
      </FormSection>
      <FormSection title={`Result ${year}B`} tone="calc">
        <FormGrid>
          <FormField label="Watchmen budget">
            <Show right>{fmt(watchmenBudget(d.value.share, cost))}</Show>
          </FormField>
          <FormField label={`${year - 1}F`}>
            <Show right>{fmt(r?.f ?? null)}</Show>
          </FormField>
        </FormGrid>
      </FormSection>
    </RecordForm>
  );
}
