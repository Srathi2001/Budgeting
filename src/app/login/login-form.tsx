'use client';

import { useActionState } from 'react';
import { login } from './actions';

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ''} />
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Email</span>
        <input name="email" type="email" required autoComplete="username" className="input mt-1 w-full" />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Password</span>
        <input name="password" type="password" required autoComplete="current-password" className="input mt-1 w-full" />
      </label>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
