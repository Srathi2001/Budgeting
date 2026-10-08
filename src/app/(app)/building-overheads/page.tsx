import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, getActiveVersion, visibleProperties, editablePropertyIds, isFinance } from '@/lib/auth/dal';
import { loadBuildingOverheads } from '@/lib/budget/boh';
import { loadContracts, loadInsurance, loadWatchmen } from '@/lib/budget/boh-schedules';
import { CONTRACT_KINDS, isContractKind } from '@/lib/budget/boh-types';
import { withDefaults } from '@/lib/engine/assumptions';
import { BuildingOverheads } from './building-overheads';
import { BohAssumptions, ContractSchedule, SecurityAllocation } from './boh-tabs';

export const metadata = { title: 'Building Overheads · Budget' };

/** a short digest of the data a tab shows */
const fingerprint = (x: unknown) => {
  let h = 0;
  for (const ch of JSON.stringify(x)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return String(h >>> 0);
};

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'assumptions', label: 'Assumptions' },
  { key: 'security-allocation', label: 'Security allocation' },
  ...CONTRACT_KINDS.map((k) => ({ key: k.kind, label: k.label })),
];

export default async function BuildingOverheadsPage({ searchParams }: PageProps<'/building-overheads'>) {
  const user = await requireUser();
  if (user.role === 'FM') redirect('/fm');
  const { version } = await getActiveVersion();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? String(sp.tab) : 'overview';
  const props = await visibleProperties(user);
  const editable = await editablePropertyIds(user, version!);
  const { blocks, cutoff } = await loadBuildingOverheads(version!, props, editable);
  const locked = version!.status === 'LOCKED';
  const finance = isFinance(user);
  const ids = props.map((p) => p.id);
  const common = { blocks, versionId: version!.id, year: version!.year, cutoff, locked, finance };

  let body: React.ReactNode;
  // each tab starts afresh when its saved data changes (the server's figures replace what was typed)
  if (tab === 'assumptions') {
    const insurance = await loadInsurance(version!.id, ids);
    const a = withDefaults(version!.assumptions);
    body = <BohAssumptions key={fingerprint([insurance, a])} {...common} assumptions={a} insurance={insurance} />;
  } else if (tab === 'security-allocation') {
    const shares = Object.fromEntries(await loadWatchmen(version!.id, ids));
    const cost = withDefaults(version!.assumptions).watchmanCost;
    body = <SecurityAllocation key={fingerprint([shares, cost])} {...common} cost={cost} shares={shares} />;
  } else if (isContractKind(tab)) {
    const rows = await loadContracts(version!.id, ids, tab);
    body = <ContractSchedule key={`${tab}-${fingerprint(rows)}`} {...common} kind={tab} rows={rows} />;
  } else body = <BuildingOverheads blocks={blocks} versionId={version!.id} versionName={version!.name} year={version!.year} cutoff={cutoff} locked={locked} finance={finance} />;

  return (
    <div>
      <nav className="seg mx-6 mt-4 flex-wrap" aria-label="Building overheads tabs">
        {TABS.map((t) => (
          <Link key={t.key} href={t.key === 'overview' ? '/building-overheads' : `/building-overheads?tab=${t.key}`} aria-current={tab === t.key ? 'page' : undefined} className={tab === t.key ? 'on' : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      {body}
    </div>
  );
}
