import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in · Budget' };

export default async function LoginPage(props: PageProps<'/login'>) {
  const sp = await props.searchParams;
  const next = typeof sp.next === 'string' ? sp.next : undefined;
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm border border-slate-200 bg-white">
        <div className="anh-brand">
          <div className="mark">AN</div>
          <div>
            <b>Al Naboodah</b>
            <span>Revenue budget</span>
          </div>
        </div>
        <div className="p-6">
          <h1 className="page-title mb-5">Sign in</h1>
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
