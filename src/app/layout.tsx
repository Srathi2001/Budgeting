import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { THEME_COOKIE } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Revenue Budget',
  description: 'Revenue master, revenue & cash forecasting',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Paper (light) is the default; Carbon (dark) is chosen per user and kept in a cookie
  const theme = (await cookies()).get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  return (
    <html lang="en" data-theme={theme} className="h-full">
      <body className="anh min-h-full">{children}</body>
    </html>
  );
}
