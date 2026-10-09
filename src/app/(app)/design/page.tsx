import { requireUser, isFinance } from '@/lib/auth/dal';
import { DesignPreview } from './preview';

export const metadata = { title: 'Design preview · Budget' };

/** Every shared primitive in its states, for review in Paper and Carbon (Finance only; not in the navigation). */
export default async function DesignPage() {
  const user = await requireUser();
  if (!isFinance(user)) return <div className="p-6">Finance access required.</div>;
  return <DesignPreview />;
}
