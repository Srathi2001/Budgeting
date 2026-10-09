import Link from 'next/link';
import { requireUser, requireVersion } from '@/lib/auth/dal';
import { loadHome, SUB_STATUSES, type HomeData, type HomeProperty, type SubStatus } from '@/lib/budget/home';
import { fmtDateTime } from '@/lib/format';
import { FacilitiesList, PropertiesList } from './home-lists';
import { PageHeader } from '@/components/ui/page-header';
import { Banner, EmptyState } from '@/components/ui/status';
import { navFor } from '@/components/shell/nav';
import { NavGlyph } from '@/components/shell/nav-icon';

export const metadata = { title: 'Home · Budget' };

export default async function HomePage() {
  const user = await requireUser();
  const version = await requireVersion();
  const data = await loadHome(user, version);
  const first = user.name.split(/\s+/)[0] ?? user.name;
  const locked = data.version.status === 'LOCKED';
  return (
    <div className="anh-main">
      <PageHeader
        eyebrow="Overview"
        title={`Good day, ${first}`}
        sub={
          <>
            {data.version.name} · {data.role === 'finance' ? 'everything in this version' : data.role === 'fm' ? 'your facilities' : 'your properties'} · amounts in AED, ex VAT
          </>
        }
      />
      {locked && (
        <Banner kind="info" title={`${data.version.name} is locked`}>
          Nothing can change in a locked version. Switch versions from the chip in the top bar.
        </Banner>
      )}
      <Attention data={data} />
      <div className="ui-home">
        <div className="ui-home__main">
          {data.role !== 'fm' && <PropertiesCard data={data} />}
          {data.role !== 'pm' && <FacilitiesCard data={data} />}
        </div>
        <div className="ui-home__side">
          <ActivityCard data={data} />
          <Shortcuts data={data} />
        </div>
      </div>
    </div>
  );
}

const countBy = (xs: { status: SubStatus }[]) => Object.fromEntries(SUB_STATUSES.map((s) => [s, xs.filter((x) => x.status === s).length])) as Record<SubStatus, number>;

/** The numbers that decide what to do next, as tiles with the link that does it. */
function Attention({ data }: { data: HomeData }) {
  const p = countBy(data.properties);
  const f = countBy(data.facilities);
  const warnings = data.properties.reduce((a, x) => a + x.warnings, 0);
  const tiles: { label: string; value: number; sub: string; href: string }[] = [];
  if (data.role === 'finance') {
    tiles.push({
      label: 'Awaiting approval',
      value: p.SUBMITTED,
      sub: 'properties submitted',
      href: '/submissions',
    });
    tiles.push({
      label: 'FM awaiting approval',
      value: f.SUBMITTED,
      sub: 'facilities submitted',
      href: '/fm',
    });
    tiles.push({
      label: 'Still in draft',
      value: p.DRAFT + p.RETURNED,
      sub: 'properties not yet submitted',
      href: '/submissions',
    });
    tiles.push({
      label: 'Open warnings',
      value: warnings,
      sub: 'lease rows to check',
      href: '/master',
    });
  } else if (data.role === 'pm') {
    tiles.push({
      label: 'To submit',
      value: p.DRAFT + p.RETURNED,
      sub: 'of your properties',
      href: '/submissions',
    });
    tiles.push({
      label: 'Returned',
      value: p.RETURNED,
      sub: 'with a note from Finance',
      href: '/submissions',
    });
    tiles.push({
      label: 'Approved',
      value: p.APPROVED,
      sub: 'read only now',
      href: '/submissions',
    });
    tiles.push({
      label: 'Open warnings',
      value: warnings,
      sub: 'lease rows to check',
      href: '/master',
    });
  } else {
    tiles.push({
      label: 'To submit',
      value: f.DRAFT + f.RETURNED,
      sub: 'of your facilities',
      href: '/fm',
    });
    tiles.push({
      label: 'Returned',
      value: f.RETURNED,
      sub: 'with a note from Finance',
      href: '/fm',
    });
    tiles.push({
      label: 'In review',
      value: f.SUBMITTED,
      sub: 'with Finance',
      href: '/fm',
    });
    tiles.push({
      label: 'Approved',
      value: f.APPROVED,
      sub: 'read only now',
      href: '/fm',
    });
  }
  return (
    <div className="ui-tiles">
      {tiles.map((t) => (
        <Link key={t.label} href={t.href} className="anh-kpi anh-kpi--compact ui-tile-link">
          <span className="anh-eyebrow">{t.label}</span>
          <span className="anh-kpi__value">{t.value}</span>
          <span className="anh-kpi__foot">{t.sub}</span>
        </Link>
      ))}
    </div>
  );
}

const byAttention = (a: HomeProperty, b: HomeProperty) => {
  const rank: Record<SubStatus, number> = {
    RETURNED: 0,
    SUBMITTED: 1,
    DRAFT: 2,
    APPROVED: 3,
  };
  return rank[a.status] - rank[b.status] || b.warnings - a.warnings || a.code.localeCompare(b.code);
};

function PropertiesCard({ data }: { data: HomeData }) {
  const rows = [...data.properties].sort(byAttention);
  const shown = rows.slice(0, 12);
  return (
    <section className="anh-card">
      <div className="anh-card__head">
        <div>
          <h2 className="anh-card__title">{data.role === 'finance' ? 'Properties' : 'Your properties'}</h2>
          <p className="anh-card__sub">Returned and submitted first, then by open warnings. Revenue is the year&rsquo;s budget, ex VAT.</p>
        </div>
        <Link href="/submissions" className="ui-btn ui-btn--secondary ui-btn--sm">
          All submissions
        </Link>
      </div>
      <div className="anh-card__body">
        {rows.length ? <PropertiesList rows={shown} /> : <EmptyState title="No properties in this version">Properties are assigned in Admin → Properties.</EmptyState>}
        {rows.length > shown.length && (
          <p className="ui-card__more">
            {rows.length - shown.length} more on <Link href="/submissions">Submissions</Link>.
          </p>
        )}
      </div>
    </section>
  );
}

function FacilitiesCard({ data }: { data: HomeData }) {
  const rows = [...data.facilities].sort((a, b) => {
    const rank: Record<SubStatus, number> = {
      RETURNED: 0,
      SUBMITTED: 1,
      DRAFT: 2,
      APPROVED: 3,
    };
    return rank[a.status] - rank[b.status] || a.code.localeCompare(b.code);
  });
  const shown = rows.slice(0, 12);
  return (
    <section className="anh-card">
      <div className="anh-card__head">
        <div>
          <h2 className="anh-card__title">{data.role === 'fm' ? 'Your facilities' : 'FM budget'}</h2>
          <p className="anh-card__sub">Maintenance and renewal works by facility; the total is the year&rsquo;s FM budget.</p>
        </div>
        <Link href="/fm" className="ui-btn ui-btn--secondary ui-btn--sm">
          FM Budget
        </Link>
      </div>
      <div className="anh-card__body">
        {rows.length ? <FacilitiesList rows={shown} /> : <EmptyState title="No FM budget lines yet">{data.role === 'fm' ? 'Start on the FM Budget page.' : 'Facilities management has not entered anything yet.'}</EmptyState>}
        {rows.length > shown.length && (
          <p className="ui-card__more">
            {rows.length - shown.length} more on <Link href="/fm">FM Budget</Link>.
          </p>
        )}
      </div>
    </section>
  );
}

function Shortcuts({ data }: { data: HomeData }) {
  const groups = navFor({
    finance: data.role === 'finance',
    fm: data.role === 'fm',
  })
    .map((g) => ({ ...g, pages: g.pages.filter((p) => p.href !== '/') }))
    .filter((g) => g.pages.length);
  return (
    <section className="anh-card">
      <div className="anh-card__head">
        <h2 className="anh-card__title">Go to</h2>
      </div>
      <div className="anh-card__body ui-shortcuts">
        {groups.map((g) => (
          <div key={g.label}>
            <span className="anh-eyebrow">{g.label}</span>
            {g.pages.map((p) => (
              <Link key={p.href} href={p.href} className="ui-shortcut">
                <NavGlyph icon={p.icon} />
                <span>
                  <b>{p.label}</b>
                  <small>{p.hint}</small>
                </span>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function ActivityCard({ data }: { data: HomeData }) {
  return (
    <section className="anh-card">
      <div className="anh-card__head">
        <div>
          <h2 className="anh-card__title">Recent activity</h2>
          <p className="anh-card__sub">The last changes to what you can see.</p>
        </div>
      </div>
      <div className="anh-card__body">
        {data.activity.length ? (
          <ol className="ui-activity">
            {data.activity.map((a) => (
              <li key={a.id}>
                <span className="ui-activity__when">{fmtDateTime(a.at)}</span>
                <span>
                  <b>{a.who ?? 'System'}</b> {a.entity.replace(/_/g, ' ')} {a.action}
                  {a.property ? ` · ${a.property}` : ''}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="anh-muted text-sm">No changes yet in this version.</p>
        )}
        {data.role !== 'fm' && (
          <p className="ui-card__more">
            Full history on <Link href="/submissions">Submissions</Link>.
          </p>
        )}
      </div>
    </section>
  );
}
