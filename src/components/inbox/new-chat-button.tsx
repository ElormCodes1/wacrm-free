'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Loader2, UserRound, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useCompanyPath } from '@/components/tenancy/company-link';

interface DirectoryEntry {
  phone: string
  name: string | null
}

/**
 * "New chat" — start a conversation with someone who has never messaged in.
 *
 * Until this existed the inbox could only offer people who had already
 * written, because that is the only way a contact row got created. So the
 * most ordinary thing a business does — message a customer first — could
 * not be done from inside the CRM at all.
 *
 * The list is the linked phone's own WhatsApp address book, read live from
 * the gateway and stored nowhere. Importing it would mean thousands of
 * contact rows for people the business will never message; instead a
 * contact becomes real at the moment somebody picks it.
 */
export function NewChatButton() {
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [starting, setStarting] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const companyPath = useCompanyPath();

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setReason(null);
    setLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/whatsapp/contacts/directory');
        const data = await res.json();
        if (cancelled) return;
        setContacts(Array.isArray(data.contacts) ? data.contacts : []);
        setReason(data.reason ?? null);
      } catch {
        if (!cancelled) toast.error('Could not load your contacts');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // Abandon a slow fetch when the dialog closes, so a late response
    // cannot repopulate a list the user has already dismissed.
    return () => {
      cancelled = true;
    };
  }, [open]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    const digits = q.replace(/\D/g, '');
    return contacts.filter(
      (c) =>
        (c.name ?? '').toLowerCase().includes(q) ||
        (digits.length > 0 && c.phone.includes(digits)),
    );
  }, [contacts, search]);

  async function start(entry: DirectoryEntry) {
    // Guard the second click. A slow first one invites another, and
    // without this that opens two threads with the same person.
    if (starting) return;
    setStarting(entry.phone);
    try {
      const res = await fetch('/api/whatsapp/contacts/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: entry.phone, name: entry.name }),
      });
      const data = await res.json();
      if (!res.ok || !data.conversation_id) {
        toast.error(data.error ?? 'Could not open that chat');
        return;
      }
      // Full load, so the newly created conversation is present in the
      // list by the time the deep-link tries to select it.
      window.location.assign(
        companyPath('inbox', { query: { c: data.conversation_id } }),
      );
    } catch {
      toast.error('Could not open that chat');
    } finally {
      setStarting(null);
    }
  }

  /**
   * Put names to the numbers already in the inbox.
   *
   * Contacts created from inbound messages keep the phone number as their
   * name whenever WhatsApp sent no pushName, which is most of them — so
   * the inbox reads as a list of digits while the phone those messages
   * came from knows exactly who these people are. Offered here because
   * this dialog is already the place where contact names are the subject.
   */
  async function refreshNames() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch('/api/whatsapp/contacts/refresh-names', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Could not update names');
        return;
      }
      toast.success(
        data.updated > 0
          ? `Named ${data.updated} contact${data.updated === 1 ? '' : 's'}`
          : 'Every contact already has a name',
      );
    } catch {
      toast.error('Could not update names');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="New chat"
        aria-label="New chat"
        className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors"
      >
        <Plus className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New chat</DialogTitle>
            <DialogDescription>
              Pick someone from this number&apos;s WhatsApp contacts.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or number"
              className="pl-9"
            />
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading contacts…
              </div>
            ) : reason === 'no-number' ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                Link a WhatsApp number first — your contacts come from the phone.
              </p>
            ) : list.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                {contacts.length === 0
                  ? 'No contacts found on this number.'
                  : 'Nobody matches that search.'}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {list.map((c) => (
                  <li key={c.phone}>
                    <button
                      onClick={() => start(c)}
                      disabled={starting !== null}
                      className="hover:bg-muted flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors disabled:opacity-50"
                    >
                      <span className="bg-muted text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                        <UserRound className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-foreground block truncate text-sm">
                          {c.name ?? c.phone}
                        </span>
                        {c.name && (
                          <span className="text-muted-foreground block truncate text-xs">
                            {c.phone}
                          </span>
                        )}
                      </span>
                      {starting === c.phone && (
                        <Loader2 className="text-muted-foreground h-4 w-4 shrink-0 animate-spin" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            onClick={refreshNames}
            disabled={refreshing}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 self-start text-xs disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`}
            />
            {refreshing
              ? 'Updating names…'
              : 'Name existing chats from this phone'}
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
