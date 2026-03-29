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
import Logo from '@/components/Logo';

const navItems = [
  { href: '/payments', label: 'Payments', icon: CreditCard },
  { href: '/api-keys', label: 'API Keys', icon: Key },
  { href: '/settlement', label: 'Settlement', icon: Banknote },
  { href: '/audit-logs', label: 'Audit Logs', icon: ScrollText },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 flex flex-col min-h-screen" style={{ background: '#191F32' }}>
      <div className="px-5 py-4 border-b border-white/10 flex items-center">
        <Logo />
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
                  ? 'bg-[#2D6BE4] text-white'
                  : 'text-white/50 hover:bg-white/10 hover:text-white'
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
