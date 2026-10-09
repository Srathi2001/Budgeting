import { redirect } from 'next/navigation';
import { requireUser, requireVersion } from '@/lib/auth/dal';
import { filteredScope } from '@/lib/filters-server';
import { propertyRollups } from '@/lib/budget/reports';
import { GROUP_NAME } from '@/lib/budget/group';
import { cashStatement, groupPnl, summaryData } from '@/lib/budget/summary';
import { Basis, StatementTable } from '@/components/statement';
import { PageHeader } from '@/components/ui/page-header';
import { GroupTable } from '@/components/group-table';

export const metadata = { title: 'Consolidated · Budget' };

/** The budget year's consolidated statements: income statement by entity and the cash flow by quarter. */
export default async function ConsolidatedPage() {
  const user = await requireUser();
  if (user.role === 'FM') redirect('/fm');
  const version = await requireVersion();
  const scope = await filteredScope(user);
  const rolls = await propertyRollups(version.id, scope.propertyIds, scope.categories);
  const { atoms, expenses } = await summaryData(version.id, user, scope, rolls);
  const year = version.year;

  return (
    <div className="anh-main">
      <PageHeader
        eyebrow="Statements"
        title={`Consolidated · ${year}B`}
        sub={`${version.name} · year totals of the budget, as the Monthly Summary · standalone entities, owners' share of the PMC properties and intergroup eliminations give ${GROUP_NAME}`}
      />
      <section className="ui-section" aria-labelledby="is-h">
        <h2 id="is-h" className="ui-section__title">
          Income statement by entity
        </h2>
        <GroupTable pnl={groupPnl(atoms, expenses)} year={year} />
        <Basis>AED, ex VAT, budget year totals. MJNH and MJN Private Office are outside the group; costs not budgeted yet show –.</Basis>
      </section>
      <section className="ui-section" aria-labelledby="cf-h">
        <h2 id="cf-h" className="ui-section__title">
          Cash flow by quarter
        </h2>
        <StatementTable
          period="quarter"
          yy={String(year).slice(2)}
          head="Cash flow"
          lines={cashStatement(atoms, expenses)}
          basis="AED. Rent cheques with VAT in their cheque month, other income as booked, security deposits received less refunded; a running balance shows its quarter-end value."
          caption={`Cash flow by quarter, ${version.name}`}
        />
      </section>
    </div>
  );
}
