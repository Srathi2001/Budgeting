const STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  SUBMITTED: 'bg-sky-100 text-sky-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  RETURNED: 'bg-amber-100 text-amber-800',
  OPEN: 'bg-emerald-100 text-emerald-800',
  LOCKED: 'bg-slate-200 text-slate-700',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STYLES[status] ?? 'bg-slate-100 text-slate-700'}`}>{status.toLowerCase()}</span>;
}
