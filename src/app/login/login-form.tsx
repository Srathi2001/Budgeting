'use client';

import { useActionState } from 'react';
import { login } from './actions';

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="next" value={next ?? ''} />
      <div className="anh-field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="username" className={`anh-input ${state?.error ? 'is-error' : ''}`} />
      </div>
      <div className="anh-field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" className={`anh-input ${state?.error ? 'is-error' : ''}`} />
      </div>
      {state?.error && <p className="anh-help is-error m-0">{state.error}</p>}
      <button type="submit" disabled={pending} className="anh-btn w-full justify-center">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
