"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, MessageSquare, UserRound, Users, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ContactHit {
  id: string;
  name: string | null;
  phone: string;
  avatar_url: string | null;
  is_group: boolean | null;
  lid: string | null;
}

interface MessageHit {
  id: string;
  conversation_id: string;
  content_text: string | null;
  content_type: string | null;
  sender_type: string;
  created_at: string;
  conversation: {
    id: string;
    contact: { id: string; name: string | null; phone: string; is_group: boolean | null } | null;
  } | null;
}

/** Highlight the matched fragment so a hit is scannable at a glance. */
function Highlight({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0 || !query) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-primary/25 text-foreground rounded-sm px-0.5">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  );
}

/**
 * A message body can be long, and the match is often nowhere near the
 * start — so window the snippet around the hit rather than truncating from
 * the beginning, which would routinely cut off the very thing searched for.
 */
function snippet(text: string, query: string, radius = 60): string {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + query.length + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

export function SearchDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [contacts, setContacts] = useState<ContactHit[]>([]);
  const [messages, setMessages] = useState<MessageHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against a slow early request overwriting a later, better one.
  const requestSeq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setContacts([]);
      setMessages([]);
      return;
    }
    // This Dialog exposes no onOpenAutoFocus hook, so focus after mount.
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setContacts([]);
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const seq = ++requestSeq.current;
    // Debounced: typing "invoice" would otherwise fire seven searches.
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (seq !== requestSeq.current) return;
        setContacts(json.contacts ?? []);
        setMessages(json.messages ?? []);
      } catch {
        if (seq === requestSeq.current) {
          setContacts([]);
          setMessages([]);
        }
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  const q = query.trim();
  const nothing = q.length >= 2 && !loading && !contacts.length && !messages.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:bg-muted/60 hover:text-foreground flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors"
        aria-label="Search"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="bg-muted hidden rounded px-1.5 py-0.5 text-[10px] font-medium sm:inline">
          ⌘K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl overflow-hidden p-0">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <div className="flex items-center gap-2 border-b px-3">
            {loading ? (
              <Loader2 className="text-muted-foreground h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <Search className="text-muted-foreground h-4 w-4 shrink-0" />
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search messages and contacts…"
              className="placeholder:text-muted-foreground flex-1 bg-transparent py-3 text-sm outline-none"
            />
          </div>

          <ScrollArea className="max-h-[60vh]">
            <div className="p-2">
              {q.length < 2 && (
                <p className="text-muted-foreground px-2 py-6 text-center text-xs">
                  Type at least two characters
                </p>
              )}

              {nothing && (
                <p className="text-muted-foreground px-2 py-6 text-center text-sm">
                  No matches for “{q}”
                </p>
              )}

              {contacts.length > 0 && (
                <>
                  <p className="text-muted-foreground px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase">
                    Contacts
                  </p>
                  {contacts.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => go(`/contacts?id=${c.id}`)}
                      className="hover:bg-muted/70 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left"
                    >
                      {c.is_group ? (
                        <Users className="text-muted-foreground h-4 w-4 shrink-0" />
                      ) : (
                        <UserRound className="text-muted-foreground h-4 w-4 shrink-0" />
                      )}
                      <span className="truncate text-sm">
                        <Highlight text={c.name || c.phone} query={q} />
                      </span>
                      {c.name && (
                        <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                          {c.lid ? "via WhatsApp" : c.phone}
                        </span>
                      )}
                    </button>
                  ))}
                </>
              )}

              {messages.length > 0 && (
                <>
                  <p className="text-muted-foreground px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wide uppercase">
                    Messages
                  </p>
                  {messages.map((m) => {
                    const who = m.conversation?.contact;
                    const label = who?.name || who?.phone || "Conversation";
                    return (
                      <button
                        key={m.id}
                        onClick={() => go(`/inbox?c=${m.conversation_id}`)}
                        className="hover:bg-muted/70 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left"
                      >
                        <MessageSquare className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className="truncate text-sm font-medium">{label}</span>
                            <span className="text-muted-foreground shrink-0 text-[11px]">
                              {new Date(m.created_at).toLocaleDateString()}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "text-muted-foreground mt-0.5 block text-xs break-words",
                              "line-clamp-2"
                            )}
                          >
                            <Highlight
                              text={snippet(m.content_text ?? "", q)}
                              query={q}
                            />
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
