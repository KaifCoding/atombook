'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, FileText, LayoutDashboard, Package, Palette, Plus, Settings, Users } from 'lucide-react';
import { useBusiness } from '@/lib/hooks';
import { ToastHost } from '@/components/ui';
import { APP_VERSION, UpdateBanner } from '@/components/UpdateBanner';

const NAV = [
  { href: '/', label: 'Home', icon: LayoutDashboard },
  { href: '/documents/', label: 'Documents', icon: FileText },
  { href: '/customers/', label: 'Customers', icon: Users },
  { href: '/items/', label: 'Items', icon: Package },
  { href: '/reports/', label: 'GST Returns', icon: BarChart3 },
  { href: '/design/', label: 'Design', icon: Palette },
  { href: '/settings/', label: 'Settings', icon: Settings },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || '/';
  const business = useBusiness();
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href.replace(/\/$/, '')));

  return (
    <div className="min-h-screen md:flex">
      {/* desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-gray-200 bg-white md:flex">
        <div className="px-5 py-5">
          <div className="text-lg font-bold text-brand-600">Atombook</div>
          <div className="truncate text-xs text-gray-500">{business?.name || 'Set up your business'}</div>
        </div>
        <div className="px-3">
          <Link href="/documents/edit/?type=tax_invoice" className="btn-primary w-full">
            <Plus size={16} /> New Document
          </Link>
        </div>
        <nav className="mt-4 flex-1 space-y-0.5 px-3">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${
                active(href) ? 'bg-brand-50 font-semibold text-brand-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon size={18} /> {label}
            </Link>
          ))}
        </nav>
        <div className="px-5 py-4 text-[11px] text-gray-400">
          Data stays on this device. Back up from Settings.
          {APP_VERSION && <div className="mt-1">Atombook v{APP_VERSION}</div>}
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>

      <ToastHost />
      <UpdateBanner />

      {/* mobile bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-gray-200 bg-white md:hidden">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${active(href) ? 'text-brand-600' : 'text-gray-500'}`}
          >
            <Icon size={20} />
            <span className="max-w-full truncate">{label.split(' ')[0]}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
