import { requireUser, visibleProperties, isFinance, editablePropertyIds, requireVersion } from '@/lib/auth/dal';
import { loadAnalysisData } from '@/lib/budget/analysis';
import { AnalysisPivot } from './analysis-pivot';

export const metadata = { title: 'Revenue Analysis · Budget' };

export default async function AnalysisPage() {
  const user = await requireUser();
  const version = await requireVersion();
  const v = version;
  const visible = await visibleProperties(user);
  const finance = isFinance(user);
  // Finance comments on any property; PMs on the properties they can still edit
  const commentable = finance ? new Set(visible.map((p) => p.id)) : await editablePropertyIds(user, v);
  const data = await loadAnalysisData(v, visible.map((p) => p.id), commentable);
  return <AnalysisPivot versionId={v.id} data={data} finance={finance} locked={v.status === 'LOCKED'} />;
}
