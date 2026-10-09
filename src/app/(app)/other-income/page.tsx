import Link from 'next/link';
import { requireUser, getActiveVersion, visibleProperties, editablePropertyIds } from '@/lib/auth/dal';
import { loadOtherIncome } from '@/lib/budget/other-income';
import { withDefaults } from '@/lib/engine/assumptions';
import { AdoptPropertyFilter } from '@/components/filter-bar';
import { OtherIncome } from './other-income';
import { OiSummary } from './oi-summary';

export const metadata = { title: 'Other Income · Budget' };

const TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'input', label: 'Other Income' },
];

export default async function OtherIncomePage({ searchParams }: PageProps<'/other-income'>) {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  const sp = await searchParams;
  const tab = sp.tab === 'summary' ? 'summary' : 'input';
  const props = await visibleProperties(user);
  const editable = await editablePropertyIds(user, version!);
  const blocks = await loadOtherIncome(version!, user, props, editable);
  // ?p=12: a property opened from the Summary (taken over as the shared Property filter)
  const linked = typeof sp.p === 'string' ? props.find((p) => p.id === Number(sp.p))?.id : undefined;
  return (
    <div>
      {linked && <AdoptPropertyFilter ids={[linked]} path="/other-income" />}
      <nav className="seg mx-6 mt-4" aria-label="Other Income tabs">
        {TABS.map((t) => (
          <Link key={t.key} href={t.key === 'input' ? '/other-income' : '/other-income?tab=summary'} aria-current={tab === t.key ? 'page' : undefined} className={tab === t.key ? 'on' : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === 'summary' ? (
        <OiSummary blocks={blocks} versionName={version!.name} year={version!.year} />
      ) : (
        <OtherIncome
          blocks={blocks}
          versionId={version!.id}
          versionName={version!.name}
          year={version!.year}
          locked={version!.status === 'LOCKED'}
          mfPct={withDefaults(version!.assumptions).mfPct}
        />
      )}
    </div>
  );
}
