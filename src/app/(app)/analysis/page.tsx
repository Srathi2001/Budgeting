import { requireUser, visibleProperties, isAdmin, isFinance, editablePropertyIds, requireVersion } from '@/lib/auth/dal';
import { loadAnalysisData } from '@/lib/budget/analysis';
import { AnalysisPivot } from './analysis-pivot';

export const metadata = { title: 'Revenue Analysis · Budget' };

export default async function AnalysisPage() {
  const user = await requireUser();
  const version = await requireVersion();
  const v = version;
  const visible = await visibleProperties(user);
  // Finance and Admin comment on any property; PMs on the properties they can still edit
  const commentable = isFinance(user) ? new Set(visible.map((p) => p.id)) : await editablePropertyIds(user, v, 'PM');
  const data = await loadAnalysisData(v, visible.map((p) => p.id), commentable);
  // the comparatives are kept by Admin (Admin page)
  return <AnalysisPivot versionId={v.id} data={data} finance={isAdmin(user)} locked={v.status === 'LOCKED'} />;
}
