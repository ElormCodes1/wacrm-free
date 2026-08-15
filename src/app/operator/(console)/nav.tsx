'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, Building2, ScrollText, LogOut } from 'lucide-react';

const ITEMS = [
  { href: '/operator', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/operator/companies', label: 'Companies', icon: Building2 },
  { href: '/operator/audit', label: 'Audit trail', icon: ScrollText },
];

export function OperatorNav() {
  const pathname = usePathname();

  return (
    <nav className="space-y-0.5">
      {ITEMS.map((item) => {
        // A company page belongs under Companies even though its URL is
        // /operator/c/<slug> — the nav should show where you are, not
        // where the router happens to have put the route.
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href) ||
            (item.href === '/operator/companies' && pathname.startsWith('/operator/c/'));

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
              active
                ? 'bg-primary-soft text-primary font-medium'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function OperatorSignOut({ name }: { name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <div className="bg-muted text-muted-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
        {name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{name}</p>
        <p className="text-muted-foreground text-[11px]">Operator</p>
      </div>
      <button
        type="button"
        disabled={busy}
        title="Sign out"
        aria-label="Sign out"
        onClick={async () => {
          setBusy(true);
          await fetch('/api/operator/logout', { method: 'POST' });
          router.replace('/operator/login');
          router.refresh();
        }}
        className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
