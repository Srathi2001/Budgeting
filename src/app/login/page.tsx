import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in · Budget' };

export default async function LoginPage(props: PageProps<'/login'>) {
  const sp = await props.searchParams;
  const next = typeof sp.next === 'string' ? sp.next : undefined;
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Revenue Budget</h1>
        <p className="mb-6 text-sm text-slate-500">Sign in to continue</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
