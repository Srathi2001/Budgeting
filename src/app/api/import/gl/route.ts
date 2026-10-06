// Reads an uploaded Account Analysis Report as a stream (the full-ledger export is hundreds of MB)
// and returns what the import would write; nothing is saved here (Admin → Account Analysis Report applies it).
// Not behind the proxy: the proxy buffers request bodies and cuts them at 10 MB.
import { getCurrentUser, isFinance } from '@/lib/auth/dal';
import { planGlImport, scanOtherIncome } from '@/lib/import/gl-other-income';

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isFinance(user)) return Response.json({ error: 'Finance access required' }, { status: 403 });
  const versionId = Number(new URL(request.url).searchParams.get('v'));
  if (!versionId || !request.body) return Response.json({ error: 'Choose the Account Analysis Report' }, { status: 400 });
  try {
    const scan = await scanOtherIncome(request.body as unknown as AsyncIterable<Uint8Array>);
    return Response.json(await planGlImport(versionId, scan));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
