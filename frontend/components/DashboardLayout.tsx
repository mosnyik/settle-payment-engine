'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { logout, isAuthenticated, getSession } from '@/lib/auth';
import { Sidebar } from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
    }
  }, [router]);

  function handleLogout() {
    logout();
    router.push('/login');
  }

  // Don't render if not authenticated (redirect in progress)
  if (typeof window !== 'undefined' && !isAuthenticated()) {
    return null;
  }

  const session = getSession();

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <header className="h-12 flex items-center justify-between px-6 border-b bg-white shrink-0">
          <span className="text-sm text-slate-500">
            {session?.name ?? session?.merchantId ?? '2Settle Dashboard'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="gap-1.5 text-slate-600 hover:text-slate-900"
          >
            <LogOut className="size-4" />
            Logout
          </Button>
        </header>
        <main className="flex-1 bg-slate-50 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
