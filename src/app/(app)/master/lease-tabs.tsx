import { RoutedTabs } from '@/components/ui/tabs';

/** The Lease Budget's tabs: the summary for Finance, then the input grid. */
export function LeaseTabs({ tab }: { tab: 'summary' | 'grid' }) {
  void tab; // the current tab comes from the address (RoutedTabs reads ?tab=)
  return (
    <RoutedTabs
      ariaLabel="Lease Budget tabs"
      tabs={[
        { href: '/master?tab=summary', label: 'Summary', param: { name: 'tab', value: 'summary' } },
        { href: '/master', label: 'Lease Budget', param: { name: 'tab', value: null } },
      ]}
    />
  );
}
