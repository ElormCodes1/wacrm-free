"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Contact } from "@/types";
import {
  Users,
  Pencil,
  Check,
  X,
  Link2,
  Copy,
  RefreshCw,
  LogOut,
  ShieldCheck,
  ShieldMinus,
  UserMinus,
  UserPlus,
  Loader2,
  Megaphone,
  Lock,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface Participant {
  id: string;
  phone: string;
  hasRealPhone: boolean;
  name?: string | null;
  admin: "admin" | "superadmin" | null;
}
interface GroupDetail {
  id: string;
  subject: string | null;
  description: string | null;
  pictureUrl: string | null;
  size: number | null;
  owner: string | null;
  announce: boolean;
  restrict: boolean;
  participants: Participant[];
}

/**
 * Group Info panel — shown in the inbox contact sidebar when the open
 * conversation is a WhatsApp group. Full admin surface: rename, edit
 * description, member management (add / remove / promote / demote),
 * group settings, invite link, and leave.
 *
 * `groupId` is the group's stored id (the contact's phone). The instance
 * is resolved server-side from the group's conversation, so no configId
 * is needed here.
 */
export function GroupInfoPanel({
  groupId,
  groupName,
  onNameResolved,
}: {
  groupId: string;
  groupName: string;
  /** Fired when the live group subject is learned, so the header + list can
   *  update from the raw id fallback without a reload. */
  onNameResolved?: (name: string) => void;
}) {
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [amOwner, setAmOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(groupName);
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState("");

  const [invite, setInvite] = useState<{ code: string; url: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/group/${groupId}`);
      const data = await res.json();
      if (res.ok && data.group) {
        setGroup(data.group as GroupDetail);
        setAmOwner(data.amOwner === true);
        const subject = (data.group.subject as string | null)?.trim();
        setName(subject || groupName);
        setDesc(data.group.description ?? "");
        if (subject && subject !== groupName) onNameResolved?.(subject);
      }
    } catch {
      /* leave the placeholder */
    } finally {
      setLoading(false);
    }
  }, [groupId, groupName, onNameResolved]);

  useEffect(() => {
    load();
  }, [load]);

  async function call(
    label: string,
    fn: () => Promise<Response>,
    okMsg?: string,
  ) {
    setBusy(label);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Action failed");
        return false;
      }
      if (okMsg) toast.success(okMsg);
      return true;
    } catch {
      toast.error("Action failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveName() {
    if (!name.trim()) return;
    const ok = await call("name", () =>
      fetch(`/api/whatsapp/group/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: name.trim() }),
      }),
    );
    if (ok) {
      setEditingName(false);
      setGroup((g) => (g ? { ...g, subject: name.trim() } : g));
    }
  }

  async function saveDesc() {
    const ok = await call("desc", () =>
      fetch(`/api/whatsapp/group/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc }),
      }),
    );
    if (ok) {
      setEditingDesc(false);
      setGroup((g) => (g ? { ...g, description: desc } : g));
    }
  }

  async function setSetting(setting: string) {
    const ok = await call(
      setting,
      () =>
        fetch(`/api/whatsapp/group/${groupId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setting }),
        }),
      "Setting updated",
    );
    if (ok) load();
  }

  async function participantAction(
    action: "remove" | "promote" | "demote",
    phone: string,
  ) {
    const ok = await call(`${action}:${phone}`, () =>
      fetch(`/api/whatsapp/group/${groupId}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, participants: [phone] }),
      }),
    );
    if (ok) load();
  }

  async function loadInvite() {
    const res = await fetch(`/api/whatsapp/group/${groupId}/invite`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.invite) setInvite(data.invite);
    else toast.error(data.error ?? "Could not fetch invite");
  }

  async function revokeInvite() {
    const ok = await call(
      "revoke",
      () => fetch(`/api/whatsapp/group/${groupId}/invite`, { method: "POST" }),
      "Invite link reset",
    );
    if (ok) {
      const res = await fetch(`/api/whatsapp/group/${groupId}/invite`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.invite) setInvite(data.invite);
    }
  }

  async function leave() {
    const ok = await call(
      "leave",
      () => fetch(`/api/whatsapp/group/${groupId}`, { method: "DELETE" }),
      "Left group",
    );
    if (ok) setGroup(null);
  }

  async function openChat(member: Participant) {
    if (!member.hasRealPhone) {
      toast.error("This member's number is private.");
      return;
    }
    setBusy(`chat:${member.phone}`);
    try {
      const res = await fetch("/api/whatsapp/conversation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: member.phone, name: member.name ?? undefined }),
      });
      const data = await res.json();
      if (res.ok && data.conversationId) {
        window.location.assign(`/inbox?c=${data.conversationId}`);
        return;
      }
      toast.error(data.error ?? "Could not open chat");
    } catch {
      toast.error("Could not open chat");
    }
    setBusy(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const members = group?.participants ?? [];
  const admins = members.filter((m) => m.admin).length;

  return (
    <div className="space-y-4">
      {/* Name */}
      <div>
        <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Users className="h-3 w-3" />
          Group
        </div>
        <div className="mt-2">
          {editingName ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-sm"
              />
              <button
                onClick={saveName}
                disabled={busy === "name"}
                className="rounded-md p-1.5 text-primary hover:bg-muted"
              >
                {busy === "name" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={() => {
                  setEditingName(false);
                  setName(group?.subject ?? groupName);
                }}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : amOwner ? (
            <button
              onClick={() => setEditingName(true)}
              className="group flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left hover:bg-muted"
            >
              <span className="truncate text-sm font-semibold text-foreground">
                {group?.subject ?? groupName}
              </span>
              <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
            </button>
          ) : (
            <div className="truncate px-1 py-0.5 text-sm font-semibold text-foreground">
              {group?.subject ?? groupName}
            </div>
          )}
          <p className="mt-0.5 px-1 text-xs text-muted-foreground">
            {group?.size ?? members.length} members · {admins} admin
            {admins === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {/* Description */}
      <div>
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Description
          </span>
          {!editingDesc && amOwner && (
            <button
              onClick={() => setEditingDesc(true)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
        {editingDesc ? (
          <div className="mt-1 space-y-1.5">
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={2}
              placeholder="Add a group description"
              className="w-full resize-none rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/60"
            />
            <div className="flex gap-1.5">
              <Button size="sm" className="h-7 text-xs" onClick={saveDesc} disabled={busy === "desc"}>
                {busy === "desc" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => {
                  setEditingDesc(false);
                  setDesc(group?.description ?? "");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-wrap px-1 text-xs text-muted-foreground">
            {group?.description || "No description"}
          </p>
        )}
      </div>

      {/* Settings — group creator only */}
      {amOwner && (
        <div className="space-y-1.5">
          <span className="px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Settings
          </span>
          <SettingToggle
            icon={Megaphone}
            label="Only admins can send"
            on={!!group?.announce}
            busy={busy === "announcement" || busy === "not_announcement"}
            onToggle={() =>
              setSetting(group?.announce ? "not_announcement" : "announcement")
            }
          />
          <SettingToggle
            icon={Lock}
            label="Only admins edit info"
            on={!!group?.restrict}
            busy={busy === "locked" || busy === "unlocked"}
            onToggle={() => setSetting(group?.restrict ? "unlocked" : "locked")}
          />
        </div>
      )}

      {/* Members */}
      <div>
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Members
          </span>
          {amOwner && (
            <button
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <UserPlus className="h-3 w-3" />
              Add
            </button>
          )}
        </div>
        <div className="mt-1 max-h-72 space-y-0.5 overflow-y-auto pr-0.5">
          {members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              busy={busy}
              canManage={amOwner}
              onOpenChat={() => openChat(m)}
              onPromote={() => participantAction("promote", m.phone)}
              onDemote={() => participantAction("demote", m.phone)}
              onRemove={() => participantAction("remove", m.phone)}
            />
          ))}
        </div>
      </div>

      {/* Invite link — group creator only */}
      {amOwner && (
      <div className="space-y-1.5">
        <span className="px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Invite link
        </span>
        {invite ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1.5">
              <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-[11px] text-foreground">{invite.url}</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(invite.url);
                  toast.success("Link copied");
                }}
                className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
            <button
              onClick={revokeInvite}
              disabled={busy === "revoke"}
              className="inline-flex items-center gap-1 px-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={`h-3 w-3 ${busy === "revoke" ? "animate-spin" : ""}`} />
              Reset link
            </button>
          </div>
        ) : (
          <button
            onClick={loadInvite}
            className="inline-flex items-center gap-1 px-1 text-xs text-primary hover:underline"
          >
            <Link2 className="h-3 w-3" />
            Show invite link
          </button>
        )}
      </div>
      )}

      {/* Leave */}
      <button
        onClick={leave}
        disabled={busy === "leave"}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
      >
        {busy === "leave" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <LogOut className="h-3.5 w-3.5" />
        )}
        Leave group
      </button>

      <AddMembersDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        existingPhones={members.map((m) => m.phone)}
        onAdd={async (phones) => {
          const ok = await call(
            "add",
            () =>
              fetch(`/api/whatsapp/group/${groupId}/participants`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "add", participants: phones }),
              }),
            "Members added",
          );
          if (ok) {
            setAddOpen(false);
            load();
          }
        }}
      />
    </div>
  );
}

function SettingToggle({
  icon: Icon,
  label,
  on,
  busy,
  onToggle,
}: {
  icon: typeof Megaphone;
  label: string;
  on: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={busy}
      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted"
    >
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="flex-1 text-xs text-foreground">{label}</span>
      <span
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
          on ? "bg-primary" : "bg-muted-foreground/40"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
            on ? "left-3.5" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function MemberRow({
  member,
  busy,
  canManage,
  onOpenChat,
  onPromote,
  onDemote,
  onRemove,
}: {
  member: Participant;
  busy: string | null;
  canManage: boolean;
  onOpenChat: () => void;
  onPromote: () => void;
  onDemote: () => void;
  onRemove: () => void;
}) {
  const isAdmin = !!member.admin;
  const rowBusy = busy?.endsWith(member.phone) ?? false;
  const label = member.name || `+${member.phone}`;
  const chatable = member.hasRealPhone;
  return (
    <div className="group/mem flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted">
      <button
        type="button"
        onClick={chatable ? onOpenChat : undefined}
        disabled={!chatable}
        title={chatable ? "Message" : "Number is private"}
        className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
          chatable ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
          {label.replace(/^\+/, "").slice(0, 2).toUpperCase()}
        </div>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{label}</span>
        {chatable && (
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover/mem:opacity-100" />
        )}
      </button>
      {isAdmin && (
        <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary">
          {member.admin === "superadmin" ? "Owner" : "Admin"}
        </span>
      )}
      {canManage &&
        (rowBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex items-center gap-0.5">
            {member.admin !== "superadmin" &&
              (isAdmin ? (
                <button
                  title="Dismiss as admin"
                  onClick={onDemote}
                  className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
                >
                  <ShieldMinus className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  title="Make admin"
                  onClick={onPromote}
                  className="rounded p-1 text-muted-foreground hover:bg-card hover:text-primary"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                </button>
              ))}
            {member.admin !== "superadmin" && (
              <button
                title="Remove from group"
                onClick={onRemove}
                className="rounded p-1 text-muted-foreground hover:bg-card hover:text-destructive"
              >
                <UserMinus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
    </div>
  );
}

function AddMembersDialog({
  open,
  onClose,
  existingPhones,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  existingPhones: string[];
  onAdd: (phones: string[]) => Promise<void>;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
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
  /* eslint-enable react-hooks/set-state-in-effect */

  const existing = new Set(existingPhones);
  const q = search.trim().toLowerCase();
  const list = contacts.filter((c) => {
    const digits = (c.phone ?? "").replace(/\D/g, "");
    if (existing.has(digits)) return false;
    if (!q) return true;
    return (c.name ?? "").toLowerCase().includes(q) || digits.includes(q);
  });

  function toggle(phone: string) {
    setSelected((prev) =>
      prev.includes(phone) ? prev.filter((p) => p !== phone) : [...prev, phone],
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add members</DialogTitle>
        </DialogHeader>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search contacts…"
          className="text-sm"
        />
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {list.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No contacts</p>
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
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border"
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
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            disabled={saving || selected.length === 0}
            onClick={async () => {
              setSaving(true);
              await onAdd(selected);
              setSaving(false);
            }}
          >
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Add {selected.length || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
