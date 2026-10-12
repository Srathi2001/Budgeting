import { db, schema } from '@/db';
import { requireUser, requireVersion, isFinance, entersData } from '@/lib/auth/dal';
import { loadTreasury } from '@/lib/budget/treasury';
import { RoutedTabs } from '@/components/ui/tabs';
import { ContingenciesTab, DepositsTab, LoansTab } from './treasury-tabs';

export const metadata = { title: 'Treasury · Budget' };

const TABS = [
  { key: 'loans', label: 'Shareholder loans' },
  { key: 'deposits', label: 'Fixed deposits' },
  { key: 'contingencies', label: 'Contingencies' },
  { key: 'tax', label: 'Corporate tax' },
] as const;

export default async function TreasuryPage({ searchParams }: PageProps<'/treasury'>) {
  const user = await requireUser();
  if (!isFinance(user)) return <div className="p-6 text-slate-600">Treasury is entered by Finance.</div>;
  const version = await requireVersion();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? 'loans';
  const data = await loadTreasury(version.id);
  const bus = (await db.select().from(schema.businessUnits)).map((b) => ({ value: b.code, label: `${b.code} ${b.name}` })).sort((a, b) => a.value.localeCompare(b.value));
  const common = { versionId: version.id, year: version.year, canEdit: version.status !== 'LOCKED' && entersData(user, 'FIN'), entities: bus };
  return (
    <div className="ui-fill flex min-h-0 flex-col">
      <div className="ui-toolbar ui-toolbar__row">
        <h1 className="ui-toolbar__title">Treasury · {version.name}</h1>
        <RoutedTabs ariaLabel="Treasury tabs" tabs={TABS.map((t) => ({ href: t.key === 'loans' ? '/treasury' : `/treasury?tab=${t.key}`, label: t.label, param: { name: 'tab', value: t.key === 'loans' ? null : t.key } }))} />
        <span className="ml-auto text-xs anh-muted">AED</span>
      </div>
      {tab === 'loans' && <LoansTab {...common} rows={data.loans} />}
      {tab === 'deposits' && <DepositsTab {...common} rows={data.deposits} />}
      {tab === 'contingencies' && <ContingenciesTab {...common} rows={data.contingencies} />}
      {tab === 'tax' && (
        <div className="max-w-3xl space-y-2 p-6 text-sm">
          <h2 className="font-semibold">Corporate tax</h2>
          <p>The tax line sits in the P&amp;L below profit before tax, as in the 2026 budget. Its rules (9% above the AED 375,000 band, the 30% interest cap, the tax group) are still to be agreed with the tax team, so the line stays blank and PAT equals PBT until then.</p>
        </div>
      )}
    </div>
  );
}
