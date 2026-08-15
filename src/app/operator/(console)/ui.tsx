import type { ReactNode } from 'react';

/**
 * The console's building blocks.
 *
 * They exist because the first version of this dashboard was assembled
 * page by page — every heading a different size, every panel a different
 * border, three ways of drawing a status. That reads as unfinished
 * regardless of how correct the code behind it is, and a tool for looking
 * at other people's businesses should not look provisional.
 *
 * Nothing here is clever. The value is that there is exactly one of each.
 */

/** Page title, one line of context, and the actions for the page. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="border-border flex flex-wrap items-start justify-between gap-4 border-b px-8 py-6">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A number worth looking at, with its label above it. */
export function Metric({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'default' | 'warn';
}) {
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</p>
      <p
        className={`mt-1.5 text-2xl font-semibold tabular-nums ${
          tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : ''
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 ring-emerald-500/25',
    open: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 ring-emerald-500/25',
    connected: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 ring-emerald-500/25',
    suspended: 'bg-red-500/12 text-red-700 dark:text-red-400 ring-red-500/25',
    close: 'bg-red-500/12 text-red-700 dark:text-red-400 ring-red-500/25',
    disconnected: 'bg-red-500/12 text-red-700 dark:text-red-400 ring-red-500/25',
  };
  const tone = map[status] ?? 'bg-muted text-muted-foreground ring-border';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

/** A bordered surface with an optional titled header strip. */
export function Card({
  title,
  action,
  children,
  padded = false,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="border-border bg-card overflow-hidden rounded-lg border">
      {title && (
        <div className="border-border flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-medium">{title}</h2>
          {action}
        </div>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------- table
//
// A real table rather than a list of rows pretending to be one: column
// headers you can read down, numerics aligned so they compare at a glance,
// and one row height throughout.

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-border bg-muted/40 border-b">
      <tr>{children}</tr>
    </thead>
  );
}

export function TH({
  children,
  align = 'left',
  className = '',
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`text-muted-foreground px-4 py-2.5 text-[11px] font-medium tracking-wider whitespace-nowrap uppercase ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  align = 'left',
  className = '',
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td
      className={`px-4 py-3 align-middle ${align === 'right' ? 'text-right tabular-nums' : ''} ${className}`}
    >
      {children}
    </td>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-border divide-y">{children}</tbody>;
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="px-8 py-16 text-center">
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-sm">{body}</p>}
    </div>
  );
}

/** Dates in a fixed, unambiguous shape — never "3 minutes ago" only. */
export function formatDate(iso: string | null, fallback = '—'): string {
  if (!iso) return fallback;
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(iso: string | null, fallback = '—'): string {
  if (!iso) return fallback;
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
