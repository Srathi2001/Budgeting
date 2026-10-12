// Who runs a script that writes: set BUDGET_ACTOR to the email of an active user (e.g.
// $env:BUDGET_ACTOR = 'admin@budget.local'). The audit log records that user, as it does for the screens.
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';

export async function scriptActor(): Promise<number> {
  const email = process.env.BUDGET_ACTOR?.trim().toLowerCase();
  if (!email) throw new Error('Say who runs this: set BUDGET_ACTOR to your user email (the audit log records it)');
  const [u] = await db.select({ id: schema.users.id, active: schema.users.active }).from(schema.users).where(eq(schema.users.email, email));
  if (!u || !u.active) throw new Error(`BUDGET_ACTOR: no active user ${email}`);
  return u.id;
}
