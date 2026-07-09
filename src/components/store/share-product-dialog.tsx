"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Search, Send, Share2 } from "lucide-react";
import { toast } from "sonner";

interface ContactRow {
  id: string;
  name: string | null;
  phone: string;
}

/**
 * Share popup for a catalog product: post it to the Business number's
 * WhatsApp Status, or pick contacts to send it to as a native product card
 * (each lands in that contact's inbox thread — find-or-create). Larger
 * reach belongs in Broadcasts (hence the server-side cap).
 */
export function ShareProductDialog({
  productId,
  productName,
  open,
  onOpenChange,
}: {
  productId: string;
  productName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sharingStatus, setSharingStatus] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setSearch("");
    setLoading(true);
    const supabase = createClient();
    void supabase
      .from("contacts")
      .select("id,name,phone")
      .eq("is_group", false)
      .order("name")
      .limit(200)
      .then(({ data }) => {
        setContacts((data ?? []) as ContactRow[]);
        setLoading(false);
      });
  }, [open]);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return contacts;
    return contacts.filter(
      (c) => (c.name ?? "").toLowerCase().includes(t) || c.phone.includes(t),
    );
  }, [contacts, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function shareToStatus() {
    setSharingStatus(true);
    try {
      const res = await fetch(
        `/api/whatsapp/store/${encodeURIComponent(productId)}/share-status`,
        { method: "POST" },
      );
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error ?? "Couldn't share to status");
        return;
      }
      toast.success("Shared to your WhatsApp status");
      onOpenChange(false);
    } finally {
      setSharingStatus(false);
    }
  }

  async function sendToContacts() {
    if (selected.size === 0) return;
    setSending(true);
    try {
      const res = await fetch(
        `/api/whatsapp/store/${encodeURIComponent(productId)}/send-contacts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contact_ids: [...selected] }),
        },
      );
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error ?? "Couldn't send the product");
        return;
      }
      const failed = (d.failed?.length as number) ?? 0;
      toast.success(
        `Sent to ${d.sent} contact${d.sent === 1 ? "" : "s"}` +
          (failed ? ` · ${failed} failed` : ""),
      );
      onOpenChange(false);
    } finally {
      setSending(false);
    }
  }

  const busy = sending || sharingStatus;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">Share “{productName}”</DialogTitle>
        </DialogHeader>

        {/* Share to status */}
        <Button
          variant="outline"
          onClick={shareToStatus}
          disabled={busy}
          className="w-full justify-start gap-2"
        >
          {sharingStatus ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Share2 className="h-4 w-4" />
          )}
          Share to WhatsApp status
        </Button>

        {/* Divider */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or send to contacts
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts"
            className="pl-8"
          />
        </div>

        <div className="max-h-64 min-h-40 overflow-y-auto rounded-lg border border-border">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              {contacts.length === 0 ? "No contacts yet" : "No matches"}
            </div>
          ) : (
            <ul>
              {filtered.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 border-b border-border/50 px-3 py-2 hover:bg-muted/50">
                    <Checkbox
                      checked={selected.has(c.id)}
                      onCheckedChange={() => toggle(c.id)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground">
                        {c.name || c.phone}
                      </span>
                      {c.name && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.phone}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={sendToContacts}
            disabled={busy || selected.size === 0}
            className="flex-1"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
