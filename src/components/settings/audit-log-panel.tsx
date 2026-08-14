'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ScrollText, User, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';

interface AuditEntry {
  id: string;
  actor_user_id: string | null;
  actor_name: string;
  action: 'insert' | 'update' | 'delete';
  table_name: string;
  record_id: string | null;
  changes: Record<string, unknown> | null;
  occurred_at: string;
}

const ACTION_LABEL: Record<AuditEntry['action'], string> = {
  insert: 'created',
  update: 'changed',
  delete: 'deleted',
};

const ACTION_TONE: Record<AuditEntry['action'], string> = {
  insert: 'text-emerald-500',
  update: 'text-amber-500',
  delete: 'text-red-500',
};

/** `contacts` → `contact`, so entries read as a sentence. */
function singular(table: string): string {
  const pretty = table.replace(/_/g, ' ');
  return pretty.endsWith('s') ? pretty.slice(0, -1) : pretty;
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v.length > 60 ? v.slice(0, 60) + '…' : v;
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60);
  return String(v);
}

/**
 * An update stores {col: {old, new}}; an insert or delete stores the row.
 * Showing the changed columns is the whole point — "changed a contact"
 * without saying what changed is not an audit trail.
 */
function ChangeSummary({ entry }: { entry: AuditEntry }) {
  const changes = entry.changes;
  if (!changes || typeof changes !== 'object') return null;

  if (entry.action === 'update') {
    const keys = Object.keys(changes);
    return (
      <ul className="mt-1 space-y-0.5">
        {keys.slice(0, 6).map((k) => {
          const pair = changes[k] as { old?: unknown; new?: unknown };
          return (
            <li key={k} className="text-muted-foreground text-xs">
              <span className="font-medium">{k.replace(/_/g, ' ')}</span>:{' '}
              <span className="line-through opacity-60">{renderValue(pair?.old)}</span>{' '}
              → <span className="text-foreground">{renderValue(pair?.new)}</span>
            </li>
          );
        })}
        {keys.length > 6 && (
          <li className="text-muted-foreground text-xs">
            +{keys.length - 6} more field{keys.length - 6 === 1 ? '' : 's'}
          </li>
        )}
      </ul>
    );
  }

  const name =
    (changes as Record<string, unknown>).name ??
    (changes as Record<string, unknown>).title ??
    (changes as Record<string, unknown>).label ??
    (changes as Record<string, unknown>).phone;
  return name ? (
    <p className="text-muted-foreground mt-1 text-xs">{renderValue(name)}</p>
  ) : null;
}

export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);

  const load = useCallback(async (n: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/audit?limit=${n}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not load the audit log');
      setEntries(json.entries ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the audit log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(limit);
  }, [load, limit]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-foreground flex items-center gap-2 text-lg font-semibold">
          <ScrollText className="h-5 w-5" />
          Audit log
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Every change to contacts, conversations, deals, tasks, numbers,
          automations, flows and tags — recorded by the database itself, so
          nothing can bypass it. Entries cannot be edited or deleted.
        </p>
      </div>

      {loading && entries.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
        </div>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          Nothing recorded yet.
        </p>
      ) : (
        <ul className="divide-border divide-y rounded-md border">
          {entries.map((e) => (
            <li key={e.id} className="px-3 py-2.5">
              <div className="flex items-start gap-2">
                {e.actor_user_id ? (
                  <User className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <Cpu className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{e.actor_name}</span>{' '}
                    <span className={ACTION_TONE[e.action]}>{ACTION_LABEL[e.action]}</span>{' '}
                    a {singular(e.table_name)}
                  </p>
                  <ChangeSummary entry={e} />
                </div>
                <time
                  className="text-muted-foreground shrink-0 text-xs"
                  dateTime={e.occurred_at}
                  title={new Date(e.occurred_at).toLocaleString()}
                >
                  {formatDistanceToNow(new Date(e.occurred_at), { addSuffix: true })}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}

      {entries.length >= limit && (
        <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + 50)}>
          Load more
        </Button>
      )}
    </div>
  );
}
