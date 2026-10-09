// The Home page lists on the DataGrid (client, because column cells are functions).
'use client';

import Link from 'next/link';
import type { HomeFacility, HomeProperty } from '@/lib/budget/home';
import { fmt } from '@/lib/format';
import { StatusBadge } from '@/components/status-badge';
import { DataGrid, type GridColumn } from '@/components/ui/data-grid';

const PROPERTY_COLUMNS: GridColumn<HomeProperty>[] = [
  {
    key: 'property',
    header: 'Property',
    cell: (r) => (
      <Link href={`/master?p=${r.id}`} className="ui-link">
        {r.code} · {r.name}
      </Link>
    ),
  },
  { key: 'bu', header: 'BU', cell: (r) => r.buName },
  { key: 'units', header: 'Units', align: 'right', cell: (r) => r.units },
  { key: 'vacant', header: 'Vacant', align: 'right', cell: (r) => r.vacantUnits || '–' },
  { key: 'warnings', header: 'Warnings', align: 'right', title: 'Lease rows with something to check', cell: (r) => r.warnings || '–' },
  { key: 'revenue', header: 'Revenue', align: 'right', title: "The year's budget rent, ex VAT", cell: (r) => fmt(r.revenue, 0) },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
];

export function PropertiesList({ rows }: { rows: HomeProperty[] }) {
  return <DataGrid columns={PROPERTY_COLUMNS} rows={rows} rowKey={(r) => r.id} dense caption="Properties and their submission status" />;
}

const FACILITY_COLUMNS: GridColumn<HomeFacility>[] = [
  {
    key: 'facility',
    header: 'Facility',
    cell: (r) => (
      <Link href={`/fm?f=${r.id}`} className="ui-link">
        {r.code} · {r.name}
      </Link>
    ),
  },
  { key: 'bu', header: 'BU', cell: (r) => r.buName },
  { key: 'lines', header: 'Lines', align: 'right', cell: (r) => r.lines || '–' },
  { key: 'total', header: 'Total', align: 'right', title: "The year's FM budget, AED", cell: (r) => fmt(r.total, 0) },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  {
    key: 'note',
    header: 'Note',
    cell: (r) => (
      <span className="ui-list__note" title={r.note ?? ''}>
        {r.note}
      </span>
    ),
  },
];

export function FacilitiesList({ rows }: { rows: HomeFacility[] }) {
  return <DataGrid columns={FACILITY_COLUMNS} rows={rows} rowKey={(r) => r.id} dense caption="Facilities and their FM budget status" />;
}
