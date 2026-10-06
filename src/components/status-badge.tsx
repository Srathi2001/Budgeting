// .anh-tag: Approved (black), In review (gray), Draft / Open (outline), Locked (dashed), Returned (hatched).
// The word carries the meaning; no colour.
const TAGS: Record<string, { cls: string; label: string }> = {
  DRAFT: { cls: '', label: 'Draft' },
  SUBMITTED: { cls: 'anh-tag--review', label: 'In review' },
  APPROVED: { cls: 'anh-tag--approved', label: 'Approved' },
  RETURNED: { cls: 'anh-tag--rejected', label: 'Returned' },
  OPEN: { cls: '', label: 'Open' },
  LOCKED: { cls: 'anh-tag--locked', label: 'Locked' },
};

export function StatusBadge({ status }: { status: string }) {
  const t = TAGS[status] ?? { cls: '', label: status.toLowerCase() };
  return <span className={`anh-tag ${t.cls}`}>{t.label}</span>;
}
