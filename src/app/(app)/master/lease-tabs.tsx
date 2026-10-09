import Link from 'next/link';

/** The Lease Budget's tabs: the summary for Finance, then the input grid. */
export function LeaseTabs({ tab }: { tab: 'summary' | 'grid' }) {
  return (
    <nav className="seg" aria-label="Lease Budget tabs">
      <Link href="/master?tab=summary" aria-current={tab === 'summary' ? 'page' : undefined} className={tab === 'summary' ? 'on' : undefined}>
        Summary
      </Link>
      <Link href="/master" aria-current={tab === 'grid' ? 'page' : undefined} className={tab === 'grid' ? 'on' : undefined}>
        Lease Budget
      </Link>
    </nav>
  );
}
