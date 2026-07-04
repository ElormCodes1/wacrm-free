"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

interface ConvRow {
  id: string;
  contact: { name: string | null; phone: string; avatar_url: string | null } | null;
}

/**
 * Pick a conversation to forward a message into. Lists active conversations
 * (self excluded) and POSTs to the forward endpoint on selection.
 */
export function ForwardDialog({
  messageId,
  fromConversationId,
  onClose,
  onForwarded,
}: {
  messageId: string | null;
  fromConversationId: string;
  onClose: () => void;
  onForwarded?: () => void;
}) {
  const [convos, setConvos] = useState<ConvRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  useEffect(() => {
    if (!messageId) return;
    setLoading(true);
    const supabase = createClient();
    supabase
      .from("conversations")
      .select("id, contact:contacts(name, phone, avatar_url)")
      .is("archived_at", null)
      .order("last_message_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        const rows = (data ?? []).map((r) => ({
          id: r.id as string,
          contact: Array.isArray(r.contact) ? r.contact[0] : r.contact,
        })) as ConvRow[];
        setConvos(rows.filter((r) => r.id !== fromConversationId));
        setLoading(false);
      });
  }, [messageId, fromConversationId]);

  async function forwardTo(conversationId: string) {
    if (!messageId) return;
    setSendingTo(conversationId);
    try {
      const res = await fetch(`/api/whatsapp/message/${messageId}/forward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to_conversation_id: conversationId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Forward failed");
        return;
      }
      toast.success("Forwarded");
      onForwarded?.();
      onClose();
    } catch {
      toast.error("Forward failed");
    } finally {
      setSendingTo(null);
    }
  }

  const filtered = convos.filter((c) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      (c.contact?.name ?? "").toLowerCase().includes(q) ||
      (c.contact?.phone ?? "").includes(q)
    );
  });

  return (
    <Dialog open={messageId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Forward to…</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search conversations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No conversations</p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={sendingTo !== null}
                onClick={() => forwardTo(c.id)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted disabled:opacity-50"
              >
                <span className="flex size-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {c.contact?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.contact.avatar_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    (c.contact?.name || c.contact?.phone || "?").charAt(0).toUpperCase()
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {c.contact?.name || c.contact?.phone || "Unknown"}
                  </span>
                  {c.contact?.name && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.contact.phone}
                    </span>
                  )}
                </span>
                {sendingTo === c.id && <Loader2 className="h-4 w-4 animate-spin" />}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
