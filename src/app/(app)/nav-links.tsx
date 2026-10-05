'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/master', label: 'Revenue Master' },
  { href: '/other-income', label: 'Other Income' },
  { href: '/summary', label: 'Monthly Summary' },
  { href: '/analysis', label: 'Revenue Analysis' },
  { href: '/pnl', label: 'Building P&L' },
  { href: '/submissions', label: 'Submissions' },
];

export function NavLinks({ finance }: { finance: boolean }) {
  const path = usePathname();
  const links = finance ? [...LINKS, { href: '/admin', label: 'Admin' }] : LINKS;
  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {links.map((l) => {
        const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-md px-3 py-1.5 text-sm ${
              active ? 'bg-sky-50 font-medium text-sky-800' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
