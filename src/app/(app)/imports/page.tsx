import { requireUser, isAdmin, requireVersion } from '@/lib/auth/dal';
import { ImportsTab } from '../admin/imports-tab';
import { PageHeader } from '@/components/ui/page-header';
import { Banner } from '@/components/ui/status';

export const metadata = { title: 'Imports · Budget' };

/** Every Oracle report the tool imports, with what to run and where it goes. Admin only. */
export default async function ImportsPage() {
  const user = await requireUser();
  if (!isAdmin(user))
    return (
      <div className="anh-main">
        <Banner kind="warning" title="Admin access required">
          Imports are run by Admin.
        </Banner>
      </div>
    );
  const version = await requireVersion();
  return (
    <div className="anh-main">
      <PageHeader eyebrow="Workflow" title="Imports" sub={`${version.name} · Oracle extracts, GL actuals and the input template`} />
      <ImportsTab version={version} admin />
    </div>
  );
}
