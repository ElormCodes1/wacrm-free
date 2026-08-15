"use client";

import { useCallback, useEffect, useState } from "react";
import type { Community } from "@/types";
import { createClient } from "@/lib/supabase/client";
import {
  Users2,
  Plus,
  Link2,
  Pencil,
  LogOut,
  Copy,
  Check,
  Loader2,
  Crown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";

const INVITE_LINK = "https://chat.whatsapp.com/";

export default function CommunitiesPage() {
  const [communities, setCommunities] = useState<Community[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editFor, setEditFor] = useState<Community | null>(null);
  const [groupsFor, setGroupsFor] = useState<Community | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/community");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load communities");
        setCommunities([]);
        return;
      }
      setCommunities(data.communities as Community[]);
    } catch {
      setError("Failed to load communities");
      setCommunities([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const leave = useCallback(
    async (c: Community) => {
      if (!window.confirm(`Leave "${c.subject}"? This removes it from the CRM.`)) return;
      setCommunities((prev) => prev?.filter((x) => x.id !== c.id) ?? prev);
      const res = await fetch(`/api/whatsapp/community/${c.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Failed to leave");
        load();
      } else {
        toast.success("Left community");
      }
    },
    [load],
  );

  const copyLink = useCallback((c: Community) => {
    if (!c.invite_code) return;
    void navigator.clipboard.writeText(`${INVITE_LINK}${c.invite_code}`);
    setCopied(c.id);
    toast.success("Invite link copied");
    setTimeout(() => setCopied((v) => (v === c.id ? null : v)), 1500);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Communities</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Group related WhatsApp groups under one community — manage them from
            the CRM.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New community
        </Button>
      </div>

      {communities === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : communities.length === 0 ? (
        <div className="flex h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Users2 className="h-6 w-6 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            No communities yet
          </p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            {error ?? "Create a community to organize your groups together."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {communities.map((c) => (
            <li key={c.id} className="flex flex-col rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Users2 className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-1 truncate text-sm font-semibold text-foreground">
                    {c.subject}
                    {c.is_owner && (
                      <Crown className="h-3 w-3 text-amber-400" aria-label="You own this community" />
                    )}
                  </p>
                  {c.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{c.description}</p>
                  )}
                </div>
              </div>

              {c.invite_code && (
                <button
                  type="button"
                  onClick={() => copyLink(c)}
                  className="mt-3 flex items-center gap-1 self-start rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {copied === c.id ? (
                    <Check className="h-3 w-3 text-positive" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  <span className="max-w-[180px] truncate">
                    {INVITE_LINK}
                    {c.invite_code}
                  </span>
                </button>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setGroupsFor(c)}>
                  <Link2 className="h-3.5 w-3.5" />
                  Groups
                </Button>
                {c.is_owner && (
                  <Button size="sm" variant="outline" onClick={() => setEditFor(c)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => leave(c)}>
                  <LogOut className="h-3.5 w-3.5" />
                  Leave
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CommunityFormSheet
        open={createOpen || !!editFor}
        community={editFor}
        onOpenChange={(v) => {
          if (!v) {
            setCreateOpen(false);
            setEditFor(null);
          }
        }}
        onSaved={load}
      />
      <ManageGroupsSheet community={groupsFor} onClose={() => setGroupsFor(null)} />
    </div>
  );
}

function CommunityFormSheet({
  open,
  community,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  community: Community | null;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const editing = !!community;

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setSubject(community?.subject ?? "");
      setDescription(community?.description ?? "");
    }
  }, [open, community]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function save() {
    if (!subject.trim()) return;
    setSaving(true);
    const res = editing
      ? await fetch(`/api/whatsapp/community/${community!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, description }),
        })
      : await fetch("/api/whatsapp/community", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, description }),
        });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error ?? "Failed to save community");
      return;
    }
    toast.success(editing ? "Community updated" : "Community created");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-border bg-popover p-0 sm:max-w-md">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle>{editing ? "Edit community" : "New community"}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Name</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Acme Customers"
                className="border-border bg-muted"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this community is about..."
                className="min-h-[90px] border-border bg-muted"
              />
            </div>
          </div>
          <div className="flex gap-2 border-t border-border/50 p-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !subject.trim()} className="flex-1">
              {saving ? "Saving..." : editing ? "Save changes" : "Create community"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface GroupContact {
  id: string;
  name: string | null;
  phone: string;
}

function ManageGroupsSheet({
  community,
  onClose,
}: {
  community: Community | null;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<GroupContact[]>([]);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!community) return;
    setLoading(true);
    (async () => {
      const supabase = createClient();
      const [{ data: gc }, res] = await Promise.all([
        supabase
          .from("contacts")
          .select("id, name, phone")
          .eq("is_group", true)
          .order("name")
          .limit(500),
        fetch(`/api/whatsapp/community/${community.id}/groups`),
      ]);
      setGroups((gc ?? []) as GroupContact[]);
      try {
        const data = await res.json();
        const ids = new Set<string>();
        const arr = Array.isArray(data.groups) ? data.groups : data.groups?.linkedGroups ?? [];
        for (const g of arr as Array<{ id?: string; jid?: string }>) {
          const jid = g.id ?? g.jid;
          if (jid) ids.add(jid.replace(/@g\.us$/, ""));
        }
        setLinked(ids);
      } catch {
        setLinked(new Set());
      }
      setLoading(false);
    })();
  }, [community]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function toggle(g: GroupContact, link: boolean) {
    if (!community) return;
    setBusy(g.id);
    const groupJid = `${g.phone}@g.us`;
    const res = await fetch(`/api/whatsapp/community/${community.id}/groups`, {
      method: link ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupJid }),
    });
    setBusy(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "Action failed");
      return;
    }
    setLinked((prev) => {
      const next = new Set(prev);
      if (link) next.add(g.phone);
      else next.delete(g.phone);
      return next;
    });
    toast.success(link ? "Group linked" : "Group unlinked");
  }

  return (
    <Sheet open={!!community} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full border-border bg-popover p-0 sm:max-w-md">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle>Groups in {community?.subject}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No groups yet — create groups from the inbox, then link them here.
              </p>
            ) : (
              <ul className="space-y-2">
                {groups.map((g) => {
                  const isLinked = linked.has(g.phone);
                  return (
                    <li
                      key={g.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm text-foreground">
                        {g.name || "Group"}
                      </span>
                      <Button
                        size="sm"
                        variant={isLinked ? "outline" : "default"}
                        disabled={busy === g.id}
                        onClick={() => toggle(g, !isLinked)}
                      >
                        {busy === g.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : isLinked ? (
                          "Unlink"
                        ) : (
                          "Link"
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
