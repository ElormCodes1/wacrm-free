"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, CircleDashed } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatusComposer } from "./status-composer";
import { StoryViewer, type ViewerGroup } from "./story-viewer";
import type { StatusFeed, StatusGroup } from "./types";
import { useNumberScope } from "@/hooks/use-number-scope";
import { toast } from "sonner";

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

/** Avatar wrapped in a seen/unseen story ring. */
function RingAvatar({
  name,
  avatarUrl,
  unseen,
}: {
  name: string;
  avatarUrl: string | null;
  unseen: boolean;
}) {
  return (
    <div
      className={`rounded-full p-[2.5px] ${
        unseen
          ? "bg-gradient-to-tr from-primary to-emerald-400"
          : "bg-muted-foreground/30"
      }`}
    >
      <div className="rounded-full bg-background p-[2px]">
        <Avatar size="lg">
          {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}

export function StatusView() {
  const [feed, setFeed] = useState<StatusFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState<{ groups: ViewerGroup[]; index: number } | null>(null);
  const postedIds = useRef<Set<string>>(new Set());

  const { configId } = useNumberScope();

  const load = useCallback(async () => {
    try {
      const url = configId
        ? `/api/whatsapp/status/feed?configId=${encodeURIComponent(configId)}`
        : "/api/whatsapp/status/feed";
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok) setFeed(data as StatusFeed);
    } finally {
      setLoading(false);
    }
  }, [configId]);

  useEffect(() => {
    load();
  }, [load]);

  const markViewed = useCallback((id: string) => {
    if (postedIds.current.has(id)) return;
    postedIds.current.add(id);
    // Optimistically flag locally + persist.
    setFeed((prev) => {
      if (!prev) return prev;
      const contacts = prev.contacts.map((g) => {
        if (!g.items.some((it) => it.id === id)) return g;
        const items = g.items.map((it) =>
          it.id === id ? { ...it, viewed_at: new Date().toISOString() } : it,
        );
        return { ...g, items, hasUnviewed: items.some((it) => !it.viewed_at) };
      });
      return { ...prev, contacts };
    });
    fetch("/api/whatsapp/status/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    }).catch(() => {});
  }, []);

  const deleteStatus = useCallback(async (id: string) => {
    const res = await fetch(`/api/whatsapp/status/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Could not delete status");
      return;
    }
    setFeed((prev) =>
      prev ? { ...prev, mine: prev.mine.filter((s) => s.id !== id) } : prev,
    );
    setViewer(null);
    toast.success("Status deleted");
  }, []);

  const contactGroups: ViewerGroup[] = useMemo(
    () =>
      (feed?.contacts ?? []).map((g) => ({
        key: g.key,
        name: g.name,
        avatar_url: g.avatar_url,
        items: g.items,
      })),
    [feed],
  );

  const mineGroup: ViewerGroup | null = useMemo(() => {
    if (!feed?.mine.length) return null;
    return { key: "mine", name: "My status", avatar_url: null, isMine: true, items: feed.mine };
  }, [feed]);

  function openContact(i: number) {
    setViewer({ groups: contactGroups, index: i });
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const contacts = feed?.contacts ?? [];
  const mine = feed?.mine ?? [];

  return (
    <div className="space-y-8">
      {/* My status */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">My status</h2>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => mineGroup && setViewer({ groups: [mineGroup], index: 0 })}
            disabled={!mineGroup}
            className="flex items-center gap-3 text-left disabled:cursor-default"
          >
            <RingAvatar name="Me" avatarUrl={null} unseen={false} />
            <div>
              <p className="text-sm font-medium">My status</p>
              <p className="text-xs text-muted-foreground">
                {mine.length
                  ? `${mine.length} update${mine.length === 1 ? "" : "s"} · ${timeAgo(mine[mine.length - 1].posted_at)}`
                  : "Tap to post an update"}
              </p>
            </div>
          </button>
          <div className="ml-auto">
            <StatusComposer onPosted={load} />
          </div>
        </div>
      </section>

      {/* Recent updates */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Recent updates</h2>
        {contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
            <CircleDashed className="mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No status updates yet</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              When your WhatsApp contacts post a status, it shows up here. You only
              receive statuses from contacts posted after your number connected.
            </p>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {contacts.map((g: StatusGroup, i) => (
              <li key={g.key}>
                <button
                  type="button"
                  onClick={() => openContact(i)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50"
                >
                  <RingAvatar name={g.name} avatarUrl={g.avatar_url} unseen={g.hasUnviewed} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{g.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {g.items.length} update{g.items.length === 1 ? "" : "s"} ·{" "}
                      {timeAgo(g.latestPostedAt)}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {viewer && (
        <StoryViewer
          groups={viewer.groups}
          startIndex={viewer.index}
          onClose={() => setViewer(null)}
          onViewed={markViewed}
          onDelete={deleteStatus}
        />
      )}
    </div>
  );
}
