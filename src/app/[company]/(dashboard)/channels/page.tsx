"use client";

import { useCallback, useEffect, useState } from "react";
import type { Channel } from "@/types";
import {
  Radio,
  Plus,
  LinkIcon,
  Send,
  Trash2,
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

const CHANNEL_LINK = "https://whatsapp.com/channel/";

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [postFor, setPostFor] = useState<Channel | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/channel");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load channels");
        setChannels([]);
        return;
      }
      setChannels(data.channels as Channel[]);
    } catch {
      setError("Failed to load channels");
      setChannels([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const remove = useCallback(
    async (c: Channel) => {
      if (
        !window.confirm(
          c.is_owner
            ? `Delete the channel "${c.name}"? This removes it on WhatsApp too and can't be undone.`
            : `Remove "${c.name}" from the CRM (unfollow)?`,
        )
      )
        return;
      setChannels((prev) => prev?.filter((x) => x.id !== c.id) ?? prev);
      const res = await fetch(`/api/whatsapp/channel/${c.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Delete failed");
        load();
      } else {
        toast.success(c.is_owner ? "Channel deleted" : "Channel removed");
      }
    },
    [load],
  );

  const copyLink = useCallback((c: Channel) => {
    if (!c.invite_code) return;
    void navigator.clipboard.writeText(`${CHANNEL_LINK}${c.invite_code}`);
    setCopied(c.id);
    toast.success("Link copied");
    setTimeout(() => setCopied((v) => (v === c.id ? null : v)), 1500);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Channels</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create WhatsApp Channels and broadcast to your subscribers — right
            from the CRM.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAddOpen(true)}>
            <LinkIcon className="h-4 w-4" />
            Add by link
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New channel
          </Button>
        </div>
      </div>

      {channels === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : channels.length === 0 ? (
        <div className="flex h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Radio className="h-6 w-6 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            No channels yet
          </p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            {error ??
              "Create a channel to broadcast updates, or add an existing one by its invite link."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {channels.map((c) => (
            <li
              key={c.id}
              className="flex flex-col rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <Radio className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1 truncate text-sm font-semibold text-foreground">
                      {c.name}
                      {c.is_owner && (
                        <Crown
                          className="h-3 w-3 text-amber-400"
                          aria-label="You own this channel"
                        />
                      )}
                    </p>
                    {c.description && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {c.description}
                      </p>
                    )}
                  </div>
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
                    {CHANNEL_LINK}
                    {c.invite_code}
                  </span>
                </button>
              )}

              <div className="mt-4 flex gap-2">
                {c.is_owner && (
                  <Button
                    size="sm"
                    onClick={() => setPostFor(c)}
                    className="flex-1"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Post
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => remove(c)}
                  className={c.is_owner ? "" : "flex-1"}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {c.is_owner ? "" : "Remove"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CreateChannelSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={load}
      />
      <AddChannelSheet open={addOpen} onOpenChange={setAddOpen} onSaved={load} />
      <PostSheet channel={postFor} onOpenChange={() => setPostFor(null)} />
    </div>
  );
}

function CreateChannelSheet({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    const res = await fetch("/api/whatsapp/channel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error ?? "Failed to create channel");
      return;
    }
    toast.success("Channel created");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-border bg-popover p-0 sm:max-w-md">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle>New channel</SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Product updates"
                className="border-border bg-muted"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this channel is about..."
                className="min-h-[90px] border-border bg-muted"
              />
            </div>
          </div>
          <div className="flex gap-2 border-t border-border/50 p-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !name.trim()} className="flex-1">
              {saving ? "Creating..." : "Create channel"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AddChannelSheet({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [invite, setInvite] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setInvite("");
  }, [open]);

  async function save() {
    if (!invite.trim()) return;
    setSaving(true);
    const res = await fetch("/api/whatsapp/channel/follow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invite }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error ?? "Failed to add channel");
      return;
    }
    toast.success("Channel added");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-border bg-popover p-0 sm:max-w-md">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle>Add channel by link</SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Invite link</Label>
              <Input
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                placeholder="https://whatsapp.com/channel/…"
                className="border-border bg-muted"
              />
              <p className="text-xs text-muted-foreground">
                Paste a channel&apos;s invite link to follow and manage it here.
              </p>
            </div>
          </div>
          <div className="flex gap-2 border-t border-border/50 p-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !invite.trim()} className="flex-1">
              {saving ? "Adding..." : "Add channel"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PostSheet({
  channel,
  onOpenChange,
}: {
  channel: Channel | null;
  onOpenChange: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (channel) setText("");
  }, [channel]);

  async function send() {
    if (!channel || !text.trim()) return;
    setSending(true);
    const res = await fetch(`/api/whatsapp/channel/${channel.id}/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    setSending(false);
    if (!res.ok) {
      toast.error(data.error ?? "Failed to post");
      return;
    }
    toast.success("Posted to channel");
    onOpenChange();
  }

  return (
    <Sheet open={!!channel} onOpenChange={(v) => !v && onOpenChange()}>
      <SheetContent side="right" className="w-full border-border bg-popover p-0 sm:max-w-md">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle>Post to {channel?.name}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Message</Label>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Share an update with your subscribers..."
                className="min-h-[140px] border-border bg-muted"
                autoFocus
              />
            </div>
          </div>
          <div className="flex gap-2 border-t border-border/50 p-4">
            <Button variant="outline" onClick={onOpenChange} className="flex-1">
              Cancel
            </Button>
            <Button onClick={send} disabled={sending || !text.trim()} className="flex-1">
              <Send className="h-4 w-4" />
              {sending ? "Posting..." : "Post"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
