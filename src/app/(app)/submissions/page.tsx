import Link from 'next/link';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireUser, getActiveVersion, visibleProperties, isFinance } from '@/lib/auth/dal';
import { propertyRollups } from '@/lib/budget/reports';
import { fmt, sum } from '@/lib/format';
import { StatusBadge } from '@/components/status-badge';
import { SubmissionActions } from './submission-actions';

export const metadata = { title: 'Submissions · Budget' };

export default async function SubmissionsPage() {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  const v = version!;
  const visible = await visibleProperties(user);
  const ids = visible.map((p) => p.id);
  const rolls = await propertyRollups(v.id, ids);
  const subs = await db.select().from(schema.submissions).where(eq(schema.submissions.versionId, v.id));
  const finance = isFinance(user);
  const open = v.status === 'OPEN';

  const activity = await db
    .select({ a: schema.auditLog, user: schema.users.name, property: schema.properties.name })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
    .leftJoin(schema.properties, eq(schema.properties.id, schema.auditLog.propertyId))
    .where(and(eq(schema.auditLog.versionId, v.id), inArray(schema.auditLog.propertyId, ids.length ? ids : [-1])))
    .orderBy(desc(schema.auditLog.at))
    .limit(60);

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-xl font-semibold">Submissions · {v.name}</h1>
        <p className="text-sm text-slate-500">
          Property managers submit each property when its inputs are complete. Finance approves, or returns it with a note for
          changes. Submitted and approved properties are read only for property managers.
        </p>
      </header>

      <div className="card overflow-auto">
        <table className="table-fin">
          <thead>
            <tr>
              <th>Property</th>
              <th>BU</th>
              <th>PC</th>
              <th className="num">Units</th>
              <th className="num">Vacant</th>
              <th className="num">Warnings</th>
              <th className="num">Revenue</th>
              <th>Status</th>
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rolls.map((r) => {
              const sub = subs.find((s) => s.propertyId === r.propertyId);
              return (
                <tr key={r.propertyId}>
                  <td>
                    <Link href={`/master?p=${r.propertyId}`} className="hover:text-sky-700 hover:underline">
                      {r.code} · {r.name}
                    </Link>
                  </td>
                  <td>{r.buName}</td>
                  <td>{r.coordinator}</td>
                  <td className="num">{r.units}</td>
                  <td className="num">{r.vacantUnits || ''}</td>
                  <td className={`num ${r.warnings ? 'text-amber-600' : ''}`}>{r.warnings || ''}</td>
                  <td className="num">{fmt(sum(r.revenue))}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="max-w-64 truncate text-xs text-slate-600" title={sub?.note ?? ''}>
                    {sub?.note}
                  </td>
                  <td>{open && <SubmissionActions versionId={v.id} propertyId={r.propertyId} status={r.status} finance={finance} warnings={r.warnings} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="card overflow-auto">
        <h2 className="border-b border-slate-200 px-4 py-2 text-sm font-semibold">Recent activity</h2>
        <table className="table-fin">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Property</th>
              <th>What</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {activity.map(({ a, user: who, property }) => (
              <tr key={a.id}>
                <td className="text-xs text-slate-500">{a.at.toLocaleString('en-GB', { timeZone: 'Asia/Dubai' })}</td>
                <td>{who}</td>
                <td>{property}</td>
                <td>
                  {a.entity.replace('_', ' ')} {a.action}
                </td>
                <td className="max-w-xl truncate font-mono text-xs text-slate-600" title={JSON.stringify(a.changes)}>
                  {describe(a.changes)}
                </td>
              </tr>
            ))}
            {!activity.length && (
              <tr>
                <td colSpan={5} className="text-slate-500">
                  No changes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function describe(changes: unknown): string {
  if (!changes || typeof changes !== 'object') return '';
  return Object.entries(changes as Record<string, unknown>)
    .map(([k, v]) => {
      if (v && typeof v === 'object' && 'from' in v && 'to' in v) {
        const c = v as { from: unknown; to: unknown };
        return `${k}: ${fmtVal(c.from)} → ${fmtVal(c.to)}`;
      }
      return `${k}: ${fmtVal(v)}`;
    })
    .join(' · ');
}

function fmtVal(v: unknown) {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'number') return fmt(v, Number.isInteger(v) ? 0 : 2);
  if (Array.isArray(v)) return `[${v.length}]`;
  return String(v);
}
