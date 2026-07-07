"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Contact } from "@/types";
import { Users, Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

/**
 * "New group" — icon button + dialog to create a WhatsApp group from the
 * inbox. Pick a name + contacts, POST /api/whatsapp/group, then jump to the
 * new group's conversation via the ?c= deep-link (full load so the freshly
 * created conversation is in the list to select).
 */
export function NewGroupButton() {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubject("");
    setSelected([]);
    setSearch("");
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("contacts")
        .select("id, name, phone, is_group")
        .eq("is_group", false)
        .order("name")
        .limit(500);
      setContacts((data ?? []) as Contact[]);
    })();
  }, [open]);

  const q = search.trim().toLowerCase();
  const list = contacts.filter((c) => {
    const digits = (c.phone ?? "").replace(/\D/g, "");
    if (!q) return true;
    return (c.name ?? "").toLowerCase().includes(q) || digits.includes(q);
  });

  function toggle(phone: string) {
    setSelected((prev) =>
      prev.includes(phone) ? prev.filter((p) => p !== phone) : [...prev, phone],
    );
  }

  async function create() {
    if (!subject.trim()) {
      toast.error("Give the group a name.");
      return;
    }
    if (selected.length === 0) {
      toast.error("Pick at least one contact.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/whatsapp/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subject.trim(), participants: selected }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not create group");
        return;
      }
      toast.success("Group created");
      if (data.conversationId) {
        window.location.assign(`/inbox?c=${data.conversationId}`);
      } else {
        setOpen(false);
      }
    } catch {
      toast.error("Could not create group");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="New group"
        aria-label="New group"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Users className="h-5 w-5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="groupname">Group name</Label>
            <Input
              id="groupname"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. VIP customers"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Add participants {selected.length > 0 && `(${selected.length})`}</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts…"
              className="text-sm"
            />
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {list.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No contacts
                </p>
              ) : (
                list.map((c) => {
                  const digits = (c.phone ?? "").replace(/\D/g, "");
                  const on = selected.includes(digits);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggle(digits)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
                        on ? "bg-primary/10" : ""
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border"
                        }`}
                      >
                        {on && <Check className="h-3 w-3" />}
                      </span>
                      <span className="flex-1 truncate text-foreground">
                        {c.name || `+${digits}`}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={create} disabled={creating}>
              {creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Create group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
