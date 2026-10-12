// Keeps an active session alive: the idle watcher calls it while the user types or clicks without
// saving. The proxy renews the session cookie on the way in; 401 there means it has already ended.
import { getCurrentUser } from '@/lib/auth/dal';

export async function GET() {
  const user = await getCurrentUser();
  return new Response(null, { status: user ? 204 : 401, headers: { 'cache-control': 'no-store' } });
}
