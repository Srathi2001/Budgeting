import { sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { fmtDateTime } from '@/lib/format';
import { LeaseImportPanel, GlImportPanel, RevenueImportPanel } from './panels';
import { lastActualMonth } from '@/lib/import/revenue-recognition';
import { GL_LEDGERS, GL_LEDGER_NAMES } from '@/lib/import/gl-other-income';
import { withDefaults } from '@/lib/engine/assumptions';

/** Every Oracle report the tool imports, in one tab: what to run, with which parameters, and where it goes. */
export async function ImportsTab({ version }: { version: schema.BudgetVersion }) {
  const Y = version.year;
  const yy = (n: number) => String(n).slice(2);
  const cutoff = withDefaults(version.assumptions).actualsCutoffMonth;
  const cutMon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][cutoff - 1];
  const lastOf = (r: { at: string; file: string | null } | undefined) => (r ? { at: String(r.at), file: r.file } : null);

  const { rows: leaseRows } = await db.execute(sql`
    select count(*)::int as lines,
      count(*) filter (where l.current_end is not null)::int as leased,
      (select json_build_object('at', at, 'file', changes->>'file') from audit_log
        where entity = 'lease_import' and version_id = ${version.id} order by at desc limit 1) as last
    from lease_lines l where l.version_id = ${version.id}`);
  const s = leaseRows[0] as { lines: number; leased: number; last: { at: string; file: string | null } | null };
  const { rows: revRows } = await db.execute(sql`
    select at, changes->>'file' as file from audit_log where entity = 'revenue_import' order by at desc limit 1`);
  const revLast = revRows[0] as { at: string; file: string | null } | undefined;
  const revTo = await lastActualMonth();
  // the last import of each ledger
  const { rows: glRows } = await db.execute(sql`
    select distinct on (changes->>'ledger') changes->>'ledger' as ledger, at, changes->>'file' as file from audit_log
    where entity = 'gl_import' and version_id = ${version.id} order by changes->>'ledger', at desc`);
  const glLast = new Map((glRows as { ledger: string; at: string; file: string | null }[]).map((r) => [r.ledger, r]));

  const REPORTS = [
    {
      id: 'lease',
      name: 'Tenant and Lease Details Report',
      where: 'Oracle: Custom Applications → Lease Reports → Reports',
      params: 'All business units · .xlsx. With it (optional): REHL+MJN+PMC (dd-mm-yyyy) - Unit Dump.xls and Maintenance Fee Report.xls',
      feeds: 'Lease Budget: units, current leases',
    },
    {
      id: 'revenue',
      name: 'Revenue Recognition Summary',
      where: 'Oracle: Property Manager → Revenue Recognition Summary',
      params: `Accounting periods Jan-${Y - 3} to the last closed month`,
      feeds: 'Revenue Analysis: rent actuals',
    },
    ...GL_LEDGER_NAMES.map((ledger, i) => ({
      id: `gl-${i + 1}`,
      name: `Account Analysis Report (not "Account Wise Analysis Report")`,
      where: 'Oracle: General Ledger',
      params: `Ledger or Ledger Set ${ledger} · Period From Jan-${yy(Y - 3)} To ${cutMon}-${yy(Y - 1)} · Balance Type Actual · Account starts with 52`,
      feeds: 'Other Income: GL actuals',
    })),
  ];

  return (
    <div className="space-y-6">
      <div className="frame">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th>Oracle report</th>
              <th>Where</th>
              <th>Parameters</th>
              <th>Goes to</th>
            </tr>
          </thead>
          <tbody>
            {REPORTS.map((r, i) => (
              <tr key={r.id}>
                <td className="muted">{i + 1}</td>
                <td>
                  <a href={`#${r.id}`} className="font-semibold hover:underline">
                    {r.name}
                  </a>
                </td>
                <td className="muted">{r.where}</td>
                <td>{r.params}</td>
                <td className="muted">{r.feeds}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div id="lease" className="scroll-mt-4">
        <LeaseImportPanel
          versionId={version.id}
          versionName={version.name}
          locked={version.status === 'LOCKED'}
          stats={{
            lines: s.lines,
            leased: s.leased,
            lastImport: s.last ? fmtDateTime(s.last.at) : null,
            lastFile: s.last?.file ?? null,
          }}
        />
      </div>
      <div id="revenue" className="scroll-mt-4">
        <RevenueImportPanel year={Y} last={revLast ? { ...lastOf(revLast)!, to: revTo } : null} />
      </div>
      {GL_LEDGER_NAMES.map((ledger, i) => (
        <div key={ledger} id={`gl-${i + 1}`} className="scroll-mt-4">
          <GlImportPanel ledger={ledger} companies={Object.keys(GL_LEDGERS[ledger].companies)} versionId={version.id} versionName={version.name} year={Y} locked={version.status === 'LOCKED'} last={lastOf(glLast.get(ledger))} cutoff={cutoff} />
        </div>
      ))}
    </div>
  );
}
