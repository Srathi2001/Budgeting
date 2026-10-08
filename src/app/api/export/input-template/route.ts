import { getCurrentUser, getActiveVersion } from '@/lib/auth/dal';
import { buildTemplate } from '@/lib/excel/cell-template';
import { buildInputTemplate, isTemplateKind, templateAccess, templateFileName } from '@/lib/excel/input-templates';

// Input template of a page (?kind=other-income | building-overheads | admin-overheads | fm-labour), for the page filters.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const kind = new URL(request.url).searchParams.get('kind');
  if (!isTemplateKind(kind)) return new Response('Unknown template', { status: 404 });
  const denied = templateAccess(kind, user);
  if (denied) return new Response(denied, { status: 403 });
  const { version } = await getActiveVersion();
  if (!version) return new Response('No version', { status: 404 });
  const t = await buildInputTemplate(kind, user, version, true);
  const buf = await buildTemplate(t, { versionName: version.name, user: user.name });
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${templateFileName(kind, version.year)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
