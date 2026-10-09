// The submissions board: status chips to narrow the list, one row per property with its action,
// confirmations in a dialog (what will happen, an optional or required note), and a history sheet.
'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { fmt, fmtDateTime } from '@/lib/format';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { DataGrid, type GridColumn } from '@/components/ui/data-grid';
import { describeChanges } from '@/lib/audit-describe';
import { propertyActivity, transition, type ActivityRow } from './actions';

export type SubStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RETURNED';

export interface BoardRow {
  propertyId: number;
  code: string;
  name: string;
  buName: string;
  coordinator: string | null;
  units: number;
  vacantUnits: number;
  warnings: number;
  revenue: number;
  status: SubStatus;
  note: string | null;
  updatedAt: string | null;
}

type Chip = 'ALL' | SubStatus | 'WARNINGS';
const CHIPS: { key: Chip; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'DRAFT', label: 'Draft' },
  { key: 'RETURNED', label: 'Returned' },
  { key: 'SUBMITTED', label: 'In review' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'WARNINGS', label: 'With warnings' },
];

type Pending = { action: 'submit' | 'approve' | 'return'; row: BoardRow } | null;

export function SubmissionsBoard({ rows, versionId, finance, open }: { rows: BoardRow[]; versionId: number; finance: boolean; open: boolean }) {
  const [chip, setChip] = useState<Chip>('ALL');
  const [pending, setPending] = useState<Pending>(null);
  const [history, setHistory] = useState<BoardRow | null>(null);
  const { toast } = useToast();

  const counts = useMemo(() => {
    const c: Record<Chip, number> = { ALL: rows.length, DRAFT: 0, RETURNED: 0, SUBMITTED: 0, APPROVED: 0, WARNINGS: 0 };
    for (const r of rows) {
      c[r.status] += 1;
      if (r.warnings) c.WARNINGS += 1;
    }
    return c;
  }, [rows]);
  const shown = useMemo(() => rows.filter((r) => (chip === 'ALL' ? true : chip === 'WARNINGS' ? r.warnings > 0 : r.status === chip)), [rows, chip]);

  const columns = useMemo<GridColumn<BoardRow>[]>(
    () => [
      {
        key: 'property',
        header: 'Property',
        cell: (r) => (
          <Link href={`/master?p=${r.propertyId}`} className="ui-link">
            {r.code} · {r.name}
          </Link>
        ),
      },
      { key: 'bu', header: 'BU', cell: (r) => r.buName },
      { key: 'pc', header: 'PC', cell: (r) => r.coordinator ?? '' },
      { key: 'units', header: 'Units', align: 'right', cell: (r) => r.units },
      { key: 'vacant', header: 'Vacant', align: 'right', cell: (r) => r.vacantUnits || '' },
      { key: 'warnings', header: 'Warnings', align: 'right', title: 'Lease rows with something to check before submitting', cell: (r) => r.warnings || '' },
      { key: 'revenue', header: 'Revenue', align: 'right', title: `The year's budget rent, ex VAT`, cell: (r) => fmt(r.revenue, 0) },
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
      { key: 'updated', header: 'Updated', cell: (r) => (r.updatedAt ? fmtDateTime(r.updatedAt) : ''), className: 'muted' },
      {
        key: 'actions',
        header: <span className="sr-only">Actions</span>,
        align: 'right',
        cell: (r) => <RowActions row={r} finance={finance} open={open} onAct={(action) => setPending({ action, row: r })} onHistory={() => setHistory(r)} />,
      },
    ],
    [finance, open],
  );

  const confirm = async (note: string | null) => {
    if (!pending) return null;
    const r = await transition(versionId, pending.row.propertyId, pending.action, note);
    if (r.error) return r.error;
    const did = pending.action === 'submit' ? 'submitted' : pending.action === 'approve' ? 'approved' : 'returned';
    toast({ kind: 'success', title: `${pending.row.code} · ${pending.row.name} ${did}` });
    return null;
  };

  return (
    <>
      <div className="ui-chips" role="group" aria-label="Show">
        {CHIPS.map((c) => (
          <button key={c.key} type="button" className="ui-chip-toggle" aria-pressed={chip === c.key} onClick={() => setChip(c.key)}>
            {c.label}
            <span className="ui-chip-toggle__n">{counts[c.key]}</span>
          </button>
        ))}
      </div>

      <DataGrid
        columns={columns}
        rows={shown}
        rowKey={(r) => r.propertyId}
        stickyLast
        caption="Properties and their submission status"
        empty={chip === 'ALL' ? 'No properties in the current filters: widen the page filters above.' : `Nothing ${CHIPS.find((c) => c.key === chip)?.label.toLowerCase()}. Pick another status, or All.`}
      />

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? `${{ submit: 'Submit', approve: 'Approve', return: 'Return' }[pending.action]} ${pending.row.code} · ${pending.row.name}` : ''}
        body={pending ? bodyFor(pending) : ''}
        confirmLabel={pending ? { submit: 'Submit', approve: 'Approve', return: 'Return' }[pending.action] : 'Confirm'}
        note={
          pending?.action === 'submit'
            ? { label: 'Note for Finance (optional)', placeholder: 'Anything Finance should know' }
            : pending?.action === 'return'
              ? { label: 'What needs to change', required: true, placeholder: 'Say which units or inputs to revisit' }
              : undefined
        }
        onConfirm={confirm}
      />

      <HistorySheet row={history} versionId={versionId} onClose={() => setHistory(null)} />
    </>
  );
}

function bodyFor(p: NonNullable<Pending>): string {
  const warn = p.row.warnings ? ` ${p.row.warnings} row warning${p.row.warnings === 1 ? ' is' : 's are'} still open; you can submit anyway.` : '';
  if (p.action === 'submit') return `The property becomes read only for property managers until Finance approves or returns it.${warn}`;
  if (p.action === 'approve') return 'The budget inputs of this property are accepted as final for this version. Finance can still return it later.';
  return 'The property goes back to its property manager with your note and can be edited again.';
}

function RowActions({ row, finance, open, onAct, onHistory }: { row: BoardRow; finance: boolean; open: boolean; onAct: (a: 'submit' | 'approve' | 'return') => void; onHistory: () => void }) {
  const s = row.status;
  return (
    <div className="flex items-center justify-end gap-1">
      {open && (s === 'DRAFT' || s === 'RETURNED') && (
        <Button size="sm" variant="primary" onClick={() => onAct('submit')}>
          Submit
        </Button>
      )}
      {open && finance && s === 'SUBMITTED' && (
        <Button size="sm" variant="primary" onClick={() => onAct('approve')}>
          Approve
        </Button>
      )}
      {open && finance && (s === 'SUBMITTED' || s === 'APPROVED') && (
        <Button size="sm" onClick={() => onAct('return')}>
          Return
        </Button>
      )}
      <Button size="sm" variant="tertiary" onClick={onHistory}>
        History
      </Button>
    </div>
  );
}

function HistorySheet({ row, versionId, onClose }: { row: BoardRow | null; versionId: number; onClose: () => void }) {
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()} variant="sheet" title={row ? `${row.code} · ${row.name}` : ''} description="Every change recorded for this property in this version, newest first.">
      {row && <HistoryBody key={row.propertyId} versionId={versionId} propertyId={row.propertyId} />}
    </Dialog>
  );
}

/** Keyed by property: mounts fresh for each one, so the rows load once per opening. */
function HistoryBody({ versionId, propertyId }: { versionId: number; propertyId: number }) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void propertyActivity(versionId, propertyId).then((r) => {
      if (!live) return;
      setRows(r.rows);
      setError(r.error ?? null);
    });
    return () => {
      live = false;
    };
  }, [versionId, propertyId]);
  if (error) return <p className="ui-field__error">{error}</p>;
  if (!rows) return <p className="anh-muted text-sm">Loading…</p>;
  if (!rows.length) return <p className="anh-muted text-sm">No changes recorded yet.</p>;
  return (
    <ol className="ui-activity">
      {rows.map((a) => (
        <li key={a.id}>
          <span className="ui-activity__when">{fmtDateTime(a.at)}</span>
          <span>
            <b>{a.who ?? 'System'}</b> {a.entity.replace(/_/g, ' ')} {a.action}
          </span>
          {a.changes ? <span className="ui-activity__detail">{describeChanges(a.changes)}</span> : null}
        </li>
      ))}
    </ol>
  );
}
