'use client';

import { useTransition, useState } from 'react';
import { transition } from './actions';

export function SubmissionActions({
  versionId,
  propertyId,
  status,
  finance,
  warnings,
}: {
  versionId: number;
  propertyId: number;
  status: string;
  finance: boolean;
  warnings: number;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: 'submit' | 'approve' | 'return', note: string | null) =>
    start(async () => {
      const r = await transition(versionId, propertyId, action, note);
      setError(r.error ?? null);
    });

  return (
    <div className="flex items-center gap-1">
      {(status === 'DRAFT' || status === 'RETURNED') && (
        <button
          className="btn"
          disabled={pending}
          onClick={() => {
            if (warnings && !confirm(`${warnings} row warning(s) are still open. Submit anyway?`)) return;
            run('submit', prompt('Note for Finance (optional)') || null);
          }}
        >
          Submit
        </button>
      )}
      {finance && status === 'SUBMITTED' && (
        <button className="btn" disabled={pending} onClick={() => run('approve', null)}>
          Approve
        </button>
      )}
      {finance && (status === 'SUBMITTED' || status === 'APPROVED') && (
        <button
          className="btn"
          disabled={pending}
          onClick={() => {
            const note = prompt('What needs to change?');
            if (note !== null) run('return', note || null);
          }}
        >
          Return
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
