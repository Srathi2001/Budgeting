import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { THEME_COOKIE, themeFromCookie } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Revenue Budget',
  description: 'Revenue master, revenue & cash forecasting',
};

// With "system", the first paint must already match the OS: this runs before any CSS is applied.
const SYSTEM_THEME_SCRIPT = `document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';`;

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Paper (light) is the default; Carbon (dark) or "follow the system" is chosen per user and kept in a cookie
  const theme = themeFromCookie((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={theme === 'system' ? undefined : theme} className="h-full" suppressHydrationWarning>
      <head>{theme === 'system' && <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} />}</head>
      <body className="anh min-h-full">{children}</body>
    </html>
  );
}
