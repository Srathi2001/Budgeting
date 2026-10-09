'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, ReadOnlyValue, Select, Textarea } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Banner, EmptyState, Skeleton, StatusLine } from '@/components/ui/status';
import { SegmentToggle } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { StatusBadge } from '@/components/status-badge';
import { DataGrid, type GridColumn } from '@/components/ui/data-grid';

interface DemoRow {
  id: number;
  property: string;
  bu: string;
  units: number;
  revenue: number;
  status: string;
  kind?: 'subtotal' | 'total';
}
const DEMO_ROWS: DemoRow[] = Array.from({ length: 400 }, (_, i) => ({
  id: i + 1,
  property: `${100 + i} · Building ${i + 1}`,
  bu: i % 3 ? 'REHL' : 'MJN',
  units: 12 + (i % 40),
  revenue: 1_250_000 + i * 13_337,
  status: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED'][i % 4],
}));
const DEMO_COLUMNS: GridColumn<DemoRow>[] = [
  { key: 'property', header: 'Property', cell: (r) => r.property },
  { key: 'bu', header: 'BU', cell: (r) => r.bu },
  { key: 'units', header: 'Units', align: 'right', cell: (r) => r.units },
  { key: 'revenue', header: 'Revenue', align: 'right', title: 'Budget rent, ex VAT', cell: (r) => r.revenue.toLocaleString('en-GB') },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  { key: 'a', header: 'Jan', align: 'right', cell: (r) => (r.revenue / 12).toFixed(0) },
  { key: 'b', header: 'Feb', align: 'right', cell: (r) => (r.revenue / 12).toFixed(0) },
  { key: 'c', header: 'Mar', align: 'right', cell: (r) => (r.revenue / 12).toFixed(0) },
  { key: 'd', header: 'Apr', align: 'right', cell: (r) => (r.revenue / 12).toFixed(0) },
  { key: 'e', header: 'May', align: 'right', cell: (r) => (r.revenue / 12).toFixed(0) },
  { key: 'f', header: 'Jun', align: 'right', cell: (r) => (r.revenue / 12).toFixed(0) },
  { key: 'g', header: 'Jul', align: 'right', cell: (r) => (r.revenue / 12).toFixed(0) },
  { key: 'h', header: 'Aug', align: 'right', cell: (r) => (r.revenue / 12).toFixed(0) },
  { key: 'i', header: 'Sep', align: 'right', cell: (r) => (r.revenue / 12).toFixed(0) },
  { key: 'j', header: 'Oct', align: 'right', cell: (r) => (r.revenue / 12).toFixed(0) },
  { key: 'k', header: 'Nov', align: 'right', cell: (r) => (r.revenue / 12).toFixed(0) },
  { key: 'l', header: 'Dec', align: 'right', cell: (r) => (r.revenue / 12).toFixed(0) },
];

export function DesignPreview() {
  const { toast } = useToast();
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [seg, setSeg] = useState<'core' | 'revenue' | 'cash'>('core');
  return (
    <div className="anh-main">
      <PageHeader
        eyebrow="Admin"
        title="Design preview"
        sub="Every shared primitive in its states · switch Light / Dark in the top bar to review both themes"
        actions={
          <>
            <Button onClick={() => toast({ kind: 'success', title: 'Saved 3 rows', body: 'Recalculated' })}>Success toast</Button>
            <Button onClick={() => toast({ kind: 'error', title: 'Not saved', body: 'The server did not answer; your edits are kept.' })}>Error toast</Button>
            <Button variant="primary" onClick={() => setDialog(true)}>
              Open dialog
            </Button>
          </>
        }
      />

      <section className="anh-card">
        <header className="anh-card__head">
          <h2 className="anh-card__title">Buttons</h2>
        </header>
        <div className="anh-card__body flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="tertiary">Tertiary</Button>
          <Button variant="destructive">Remove unit</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="sm" variant="primary">
            Small primary
          </Button>
          <SegmentToggle
            ariaLabel="Columns"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'core', label: 'Core' },
              { value: 'revenue', label: '+ Revenue' },
              { value: 'cash', label: '+ Cash' },
            ]}
          />
        </div>
      </section>

      <section className="anh-card">
        <header className="anh-card__head">
          <h2 className="anh-card__title">Fields</h2>
        </header>
        <div className="anh-card__body grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Budget rate" hint="AED per sq ft per year" required>
            <Input numeric defaultValue="42,000.00" />
          </Field>
          <Field label="Vacancy days" error="Enter the empty days after the lease ends" required>
            <Input numeric placeholder="e.g. 60" />
          </Field>
          <Field label="Outcome">
            <Select defaultValue="New tenant">
              <option>Renew</option>
              <option>New tenant</option>
              <option>Not re-let</option>
            </Select>
          </Field>
          <Field label="Contract amount" hint="Fixed: from the Oracle import">
            <ReadOnlyValue numeric>1,234,567.00</ReadOnlyValue>
          </Field>
          <Field label="Notes" className="md:col-span-2">
            <Textarea rows={2} placeholder="Anything Finance should know" />
          </Field>
        </div>
      </section>

      <section className="anh-card">
        <header className="anh-card__head">
          <h2 className="anh-card__title">Status</h2>
        </header>
        <div className="anh-card__body grid gap-4">
          <div className="flex flex-wrap items-center gap-6">
            <StatusLine kind="saving" />
            <StatusLine kind="saved" text="Saved 3 rows · recalculated" />
            <StatusLine kind="unsaved" unsaved={2} />
            <StatusLine kind="error" text="Not saved: network error" unsaved={2} onRetry={() => toast({ kind: 'info', title: 'Retrying…' })} />
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge status="DRAFT" />
            <StatusBadge status="SUBMITTED" />
            <StatusBadge status="APPROVED" />
            <StatusBadge status="RETURNED" />
            <StatusBadge status="LOCKED" />
          </div>
          <Banner kind="error" title="2 changes were rejected" actions={<Button size="sm">Show</Button>}>
            B-1203: Fixed: comes from the Oracle import (currentRent)
          </Banner>
          <Banner kind="warning" title="No current leases are entered for 2027 Budget yet">
            Import the Tenant and Lease Details Report in Workflow → Imports.
          </Banner>
          <Banner kind="success">Template applied: 48 lines and 3 RERA ranges saved · recalculated</Banner>
          <Banner kind="info">Figures are AED, budget year 2027, vs 2026F (actuals to Aug + Lease Budget projection).</Banner>
        </div>
      </section>

      <section className="ui-section" aria-labelledby="dg-h">
        <h2 id="dg-h" className="ui-section__title">
          DataGrid · 400 rows, windowed, sticky header and first column
        </h2>
        <div className="ui-chips" role="group" aria-label="Filter chips">
          <button type="button" className="ui-chip-toggle" aria-pressed="true">
            All <span className="ui-chip-toggle__n">400</span>
          </button>
          <button type="button" className="ui-chip-toggle" aria-pressed="false">
            Draft <span className="ui-chip-toggle__n">100</span>
          </button>
          <button type="button" className="ui-chip-toggle" aria-pressed="false">
            With warnings <span className="ui-chip-toggle__n">0</span>
          </button>
        </div>
        <DataGrid columns={DEMO_COLUMNS} rows={DEMO_ROWS} rowKey={(r) => r.id} maxHeight={360} dense caption="Demo grid" />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <EmptyState title="Nothing due" action={<Button variant="primary">Open Lease Budget</Button>}>
          Every property you manage is submitted or approved.
        </EmptyState>
        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-3">
            <Skeleton kind="tile" />
            <Skeleton kind="tile" />
            <Skeleton kind="tile" />
          </div>
          <Skeleton kind="table" rows={4} />
        </div>
      </section>

      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        title="Return to the property manager"
        description="Al Qusais Building 3 · the property becomes editable again"
        footer={
          <>
            <Button variant="tertiary" onClick={() => setDialog(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setConfirm(true)}>
              Continue
            </Button>
          </>
        }
      >
        <Field label="What needs to change" required>
          <Textarea rows={3} placeholder="e.g. RERA index for 2BR units is missing" />
        </Field>
        <div className="mt-3">
          <Button variant="tertiary" onClick={() => setSheet(true)}>
            Open a side sheet
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={sheet}
        onOpenChange={setSheet}
        variant="sheet"
        title="B-1203 · side sheet"
        description="Row forms and imports open here"
        footer={
          <Button variant="primary" onClick={() => setSheet(false)}>
            Done
          </Button>
        }
      >
        <p className="text-[13px]">Sheets are full-height, resizable in Phase 1, and become full-screen under 1024 px.</p>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Remove B-1203 from this budget version?"
        body="The unit's inputs and calculated revenue are removed from 2027 Budget. The unit itself stays and returns with the next lease import."
        confirmLabel="Remove unit"
        destructive
        onConfirm={async () => {
          toast({ kind: 'success', title: 'Removed B-1203' });
          setDialog(false);
        }}
      />
    </div>
  );
}
