import { Skeleton } from '@/components/ui/status';

/** Shown while a page's data loads: the page head, a row of tiles and a table outline. */
export default function Loading() {
  return (
    <div className="anh-main" aria-busy="true" aria-label="Loading">
      <div className="ui-pagehead">
        <div className="ui-pagehead__row">
          <div className="grid gap-2" style={{ width: 320 }}>
            <Skeleton style={{ width: 80 }} className="h-2.5" />
            <Skeleton className="h-6" />
            <Skeleton className="h-2.5" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} kind="tile" />
        ))}
      </div>
      <Skeleton kind="table" rows={8} />
    </div>
  );
}
