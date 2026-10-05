// Lists a folder of the Fusion BI Publisher catalog (read-only), to find a report's exact path.
//
//   npx tsx scripts/fusion-catalog.ts [folder] [depth]        e.g.  /Custom 3
import 'dotenv/config';

const base = (process.env.FUSION_URL ?? '').replace(/\/+$/, '');
const user = process.env.FUSION_USER ?? '';
const pass = process.env.FUSION_PASSWORD ?? '';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Item {
  path: string;
  name: string;
  type: string;
}

async function list(folder: string): Promise<Item[]> {
  const body = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="http://xmlns.oracle.com/oxp/service/v2">
  <soapenv:Body>
    <v2:getFolderContents>
      <v2:folderAbsolutePath>${esc(folder)}</v2:folderAbsolutePath>
      <v2:userID>${esc(user)}</v2:userID>
      <v2:password>${esc(pass)}</v2:password>
    </v2:getFolderContents>
  </soapenv:Body>
</soapenv:Envelope>`;
  const res = await fetch(`${base}/xmlpserver/services/v2/CatalogService`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: '' },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300)}`);
  const items: Item[] = [];
  for (const m of text.matchAll(/<(?:\w+:)?catalogContents>([\s\S]*?)<\/(?:\w+:)?catalogContents>/g)) {
    const get = (n: string) => new RegExp(`<(?:\\w+:)?${n}>([\\s\\S]*?)</(?:\\w+:)?${n}>`).exec(m[1])?.[1] ?? '';
    items.push({ path: get('absolutePath'), name: get('displayName'), type: get('type') });
  }
  return items;
}

async function walk(folder: string, depth: number, indent = '') {
  let items: Item[];
  try {
    items = await list(folder);
  } catch (e) {
    console.log(`${indent}✗ ${folder}: ${(e as Error).message}`);
    return;
  }
  for (const it of items) {
    console.log(`${indent}${it.type === 'Folder' ? '📁' : '·'} ${it.name}  [${it.type}]  ${it.path}`);
    if (it.type === 'Folder' && depth > 1) await walk(it.path, depth - 1, indent + '   ');
  }
}

walk(process.argv[2] ?? '/', Number(process.argv[3] ?? 1)).catch((e) => {
  console.error('FAILED', (e as Error).message);
  process.exit(1);
});
