// Connection test for the Oracle Fusion BI Publisher report service.
// Runs the Lease Status Summary Report once and shows what comes back. Changes nothing in the database.
//
//   npx tsx scripts/fusion-test.ts [catalog path]
//
// Reads FUSION_URL, FUSION_USER, FUSION_PASSWORD and FUSION_LEASE_REPORT from .env.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLeaseReport } from '../src/lib/import/fusion';

const base = (process.env.FUSION_URL ?? '').replace(/\/+$/, '');
const user = process.env.FUSION_USER ?? '';
const pass = process.env.FUSION_PASSWORD ?? '';
const folderPath = process.argv[2] ?? process.env.FUSION_LEASE_REPORT ?? '';

if (!base || !user || !pass || !folderPath) {
  console.error('Set FUSION_URL, FUSION_USER, FUSION_PASSWORD and FUSION_LEASE_REPORT in .env');
  process.exit(1);
}

const endpoint = `${base}/xmlpserver/services/ExternalReportWSSService`;
const auth = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The catalog shows "Shared Folders/…"; the service wants an absolute path ending in .xdo.
// Custom reports usually sit under /Custom, so try both.
const p = folderPath.replace(/^\/?(Shared Folders\/)?/, '').replace(/\.xdo$/, '');
const candidates = [`/Custom/${p}.xdo`, `/${p}.xdo`];

function envelope(path: string, format: string) {
  return `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:pub="http://xmlns.oracle.com/oxp/service/PublicReportService">
  <soap:Header/>
  <soap:Body>
    <pub:runReport>
      <pub:reportRequest>
        <pub:attributeFormat>${format}</pub:attributeFormat>
        <pub:reportAbsolutePath>${esc(path)}</pub:reportAbsolutePath>
        <pub:sizeOfDataChunkDownload>-1</pub:sizeOfDataChunkDownload>
      </pub:reportRequest>
      <pub:appParams></pub:appParams>
    </pub:runReport>
  </soap:Body>
</soap:Envelope>`;
}

const tag = (xml: string, name: string) => new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml)?.[1] ?? null;

async function run(path: string, format: string) {
  const t0 = Date.now();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/soap+xml; charset=UTF-8', Authorization: auth },
    body: envelope(path, format),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  const bytes = tag(text, 'reportBytes');
  if (res.ok && bytes) return { ok: true as const, data: Buffer.from(bytes, 'base64'), contentType: tag(text, 'reportContentType'), ms };
  const fault = tag(text, 'Text') ?? tag(text, 'faultstring') ?? text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300);
  return { ok: false as const, status: res.status, fault, ms };
}

async function main() {
  console.log(`Endpoint: ${endpoint}\nUser:     ${user}\n`);
  const out = join(process.cwd(), 'tmp');
  mkdirSync(out, { recursive: true });
  for (const path of candidates) {
    // xlsx feeds the existing parser; csv / xml show the raw data if the layout has no Excel output
    for (const format of ['xlsx', 'csv', 'xml']) {
      const r = await run(path, format);
      if (!r.ok) {
        console.log(`✗ ${path} [${format}]  HTTP ${r.status}  ${r.fault}`);
        if (r.status === 401) return console.log('\nLogin rejected: check the user / password, or whether this user can sign in without SSO.');
        if (/not found|does not exist|no such/i.test(r.fault)) break; // wrong path: skip other formats
        continue;
      }
      const file = join(out, `fusion-lease-report.${format}`);
      writeFileSync(file, r.data);
      console.log(`✓ ${path} [${format}]  ${r.data.length.toLocaleString()} bytes in ${(r.ms / 1000).toFixed(1)} s  (${r.contentType})  → ${file}`);
      if (format === 'xlsx') {
        try {
          const leases = parseLeaseReport(r.data);
          console.log(`  Parsed ${leases.length} lease rows. First 3:`);
          for (const l of leases.slice(0, 3)) console.log(`   ${l.businessUnit} | ${l.unitCode} | ${l.leaseNumber} | ${l.tenantName} | ${l.leaseStart} → ${l.leaseEnd} | ${l.actualLeaseAmount}`);
        } catch (e) {
          console.log(`  Could not parse as the lease report: ${(e as Error).message}`);
        }
      } else {
        console.log('  First lines:\n' + r.data.toString('utf8').split(/\r?\n/).slice(0, 5).map((l) => '   ' + l.slice(0, 200)).join('\n'));
      }
      return;
    }
  }
  console.log('\nNo variant worked. Check the exact catalog path (Reports and Analytics → Browse Catalog → the report → More → Properties).');
}

main().catch((e) => {
  console.error('FAILED', (e as Error).message);
  process.exit(1);
});
