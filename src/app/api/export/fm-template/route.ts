import { getCurrentUser, getActiveVersion } from '@/lib/auth/dal';
import { filteredScope } from '@/lib/filters-server';
import { loadFmTemplate } from '@/lib/budget/fm-page';
import { buildFmTemplate } from '@/lib/budget/fm-excel';

// FM Budget input template (instructions, facilities, budgeted costs) for the facilities in the page filters.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { version } = await getActiveVersion();
  if (!version) return new Response('No version', { status: 404 });
  const scope = await filteredScope(user);
  const { page, facilities } = await loadFmTemplate(version, user, scope.propertyIds);
  const one = facilities.length === 1 ? facilities[0] : null;
  const buf = await buildFmTemplate(facilities, {
    versionName: version.name,
    year: version.year,
    user: user.name,
    scope: one ? `${one.code} ${one.name}` : `${facilities.length} facilities`,
    priorLabel: page.priorLabel,
    actualLabel: page.actualLabel,
    locked: page.version.locked,
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="FM Budget input ${version.year} - ${one ? one.code : 'all'}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
