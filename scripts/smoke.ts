// Smoke test against a running server: creates sessions for a finance user and a PM,
// then fetches every page and export and reports status codes.
//   npx tsx scripts/smoke.ts [baseUrl]
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { signSession } from '../src/lib/auth/session';

const base = process.argv[2] ?? 'http://localhost:3000';
const password = process.env.SEED_PASSWORD ?? 'ChangeMe!2027';

async function signIn(email: string): Promise<string> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new Error(`Bad credentials for ${email}`);
  const token = await signSession({ uid: user.id, role: user.role, coordinator: user.coordinator, name: user.name });
  return `session=${token}`;
}

async function main() {
  for (const email of ['finance@budget.local', 'ruchi@budget.local']) {
    const cookie = await signIn(email);
    console.log(`\n${email}`);
    for (const path of ['/', '/master', '/master?p=1', '/summary', '/summary?view=cash', '/analysis', '/pnl', '/other-income', '/summary?view=flow', '/submissions', '/admin', '/admin?tab=fusion', '/admin?tab=gl','/admin?tab=versions', '/admin?tab=assumptions', '/admin?tab=rera', '/admin?tab=comparatives', '/admin?tab=users', '/admin?tab=properties', '/api/export/comparatives', '/api/export/master', '/api/export/analysis', '/api/export/pnl', '/api/export/template']) {
      const t = Date.now();
      const res = await fetch(`${base}${path}`, { headers: { cookie }, redirect: 'manual' });
      const body = await res.arrayBuffer();
      const text = res.headers.get('content-type')?.includes('html') ? new TextDecoder().decode(body) : '';
      const err = /Application error|Unhandled Runtime Error|Error: /.exec(text)?.[0] ?? '';
      console.log(`${String(res.status).padEnd(4)} ${path.padEnd(28)} ${String(body.byteLength).padStart(9)} bytes ${String(Date.now() - t).padStart(6)} ms ${err}`);
    }
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
