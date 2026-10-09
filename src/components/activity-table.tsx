// The audit trail as a table (Submissions, and anywhere a change history is shown).
'use client';

import { DataGrid, type GridColumn } from '@/components/ui/data-grid';
import { describeChanges } from '@/lib/audit-describe';
import { fmtDateTime } from '@/lib/format';

export interface ActivityItem {
  id: number;
  at: string;
  who: string | null;
  property: string | null;
  entity: string;
  action: string;
  changes: unknown;
}

const COLUMNS: GridColumn<ActivityItem>[] = [
  { key: 'when', header: 'When', width: 150, cell: (a) => fmtDateTime(a.at), className: 'muted' },
  { key: 'who', header: 'Who', cell: (a) => a.who ?? 'System' },
  { key: 'property', header: 'Property', cell: (a) => a.property ?? '' },
  { key: 'what', header: 'What', cell: (a) => `${a.entity.replace(/_/g, ' ')} ${a.action}` },
  { key: 'details', header: 'Details', cell: (a) => <span className="ui-activity__detail">{describeChanges(a.changes)}</span>, className: 'ui-grid__wrap' },
];

export function ActivityTable({ items, dense = true }: { items: ActivityItem[]; dense?: boolean }) {
  return <DataGrid columns={COLUMNS} rows={items} rowKey={(a) => a.id} dense={dense} caption="Recent activity" empty="No changes yet." maxHeight={480} />;
}
