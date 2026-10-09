import { requireUser, visibleProperties, editablePropertyIds, requireVersion } from '@/lib/auth/dal';
import { loadOtherIncome } from '@/lib/budget/other-income';
import { withDefaults } from '@/lib/engine/assumptions';
import { AdoptPropertyFilter } from '@/components/filter-bar';
import { RoutedTabs } from '@/components/ui/tabs';
import { OtherIncome } from './other-income';
import { OiSummary } from './oi-summary';

export const metadata = { title: 'Other Income · Budget' };

const TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'input', label: 'Other Income' },
];

export default async function OtherIncomePage({ searchParams }: PageProps<'/other-income'>) {
  const user = await requireUser();
  const version = await requireVersion();
  const sp = await searchParams;
  const tab = sp.tab === 'summary' ? 'summary' : 'input';
  const props = await visibleProperties(user);
  const editable = await editablePropertyIds(user, version);
  const blocks = await loadOtherIncome(version, user, props, editable);
  // ?p=12: a property opened from the Summary (taken over as the shared Property filter)
  const linked = typeof sp.p === 'string' ? props.find((p) => p.id === Number(sp.p))?.id : undefined;
  return (
    <div className="ui-fill flex min-h-0 flex-col">
      {linked && <AdoptPropertyFilter ids={[linked]} path="/other-income" />}
      <div className="ui-toolbar ui-toolbar__row">
        <RoutedTabs ariaLabel="Other Income tabs" tabs={TABS.map((t) => ({ href: t.key === 'input' ? '/other-income' : '/other-income?tab=summary', label: t.label, param: { name: 'tab', value: t.key === 'input' ? null : t.key } }))} />
      </div>
      {tab === 'summary' ? (
        <OiSummary blocks={blocks} versionName={version.name} year={version.year} cutoff={withDefaults(version.assumptions).actualsCutoffMonth} />
      ) : (
        <OtherIncome
          blocks={blocks}
          versionId={version.id}
          versionName={version.name}
          year={version.year}
          locked={version.status === 'LOCKED'}
          mfPct={withDefaults(version.assumptions).mfPct}
          cutoff={withDefaults(version.assumptions).actualsCutoffMonth}
        />
      )}
    </div>
  );
}
