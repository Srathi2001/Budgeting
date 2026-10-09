import Link from 'next/link';
import { EmptyState } from '@/components/ui/status';

export default function NotFound() {
  return (
    <div className="anh-main">
      <EmptyState title="There is no page at this address" action={<Link href="/" className="ui-btn ui-btn--primary ui-btn--md">Go home</Link>}>
        The link may be out of date, or the page may have moved.
      </EmptyState>
    </div>
  );
}
