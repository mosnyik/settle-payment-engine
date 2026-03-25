'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  CreditCard,
  Key,
  Banknote,
  ScrollText,
} from 'lucide-react';

const navItems = [
  { href: '/payments', label: 'Payments', icon: CreditCard },
  { href: '/api-keys', label: 'API Keys', icon: Key },
  { href: '/settlement', label: 'Settlement', icon: Banknote },
  { href: '/audit-logs', label: 'Audit Logs', icon: ScrollText },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 flex flex-col bg-slate-900 text-slate-100 min-h-screen">
      <div className="px-5 py-5 border-b border-slate-700">
        <span className="font-semibold text-base tracking-tight text-white">2Settle Admin</span>
      </div>
      <nav className="flex flex-col gap-1 p-3 flex-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
