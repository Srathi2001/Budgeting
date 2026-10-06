import { getCurrentUser, getActiveVersion, visibleProperties, editablePropertyIds } from '@/lib/auth/dal';
import { loadMasterRows } from '@/lib/budget/master';
import { buildTemplate } from '@/lib/budget/excel-template';

// Lease Budget input template (instructions + input sheet) for the properties in view: ?p=all | ?p=12,14
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { version } = await getActiveVersion();
  if (!version) return new Response('No version', { status: 404 });
  const p = new URL(request.url).searchParams.get('p');
  const visible = await visibleProperties(user);
  const wanted = new Set((p && p !== 'all' ? p.split(',') : []).map(Number));
  const props = wanted.size ? visible.filter((x) => wanted.has(x.id)) : visible;
  const rows = await loadMasterRows(version.id, { propertyIds: props.map((x) => x.id), editableProperties: await editablePropertyIds(user, version) });
  const scope = props.length === 1 ? `${props[0].code} ${props[0].name}` : props.length === visible.length ? 'All properties' : `${props.length} properties`;
  const buf = await buildTemplate(rows, { versionName: version.name, year: version.year, user: user.name, scope });
  const name = `Lease Budget input ${version.year} - ${props.length === 1 ? props[0].code : 'all'}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  });
}
