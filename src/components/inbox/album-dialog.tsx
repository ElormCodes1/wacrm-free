"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, X, Images } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from "@/lib/storage/upload-media";

const CHAT_MEDIA_BUCKET = "chat-media";
const MAX_ITEMS = 10;
const ACCEPT = "image/png,image/jpeg,image/webp,video/mp4,video/3gpp";

interface AlbumItem {
  type: "image" | "video";
  mediaUrl: string;
  /** Storage path — GC'd if the item is removed or the dialog is cancelled. */
  path: string;
}

/**
 * Compose and send an album — 2+ photos/videos grouped into one WhatsApp
 * album. Each pick uploads to chat-media immediately (staged); Send posts
 * the set to /api/whatsapp/send-album. Cancelling GCs any staged uploads.
 */
export function AlbumDialog({
  conversationId,
  open,
  onClose,
}: {
  conversationId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<AlbumItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const gc = useCallback((path: string) => {
    void deleteAccountMedia(CHAT_MEDIA_BUCKET, path).catch(() => {});
  }, []);

  const close = useCallback(() => {
    // Discard any staged-but-unsent uploads.
    items.forEach((i) => gc(i.path));
    setItems([]);
    onClose();
  }, [items, gc, onClose]);

  const handlePick = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const room = MAX_ITEMS - items.length;
      const picked = Array.from(files).slice(0, room);
      if (picked.length < files.length) {
        toast.error(`An album holds up to ${MAX_ITEMS} items.`);
      }
      setBusy(true);
      try {
        for (const file of picked) {
          const isVideo = file.type.startsWith("video/");
          const kind = isVideo ? "video" : "image";
          if (file.size > MEDIA_MAX_BYTES_BY_KIND[kind]) {
            toast.error(
              `${file.name} is too large (${kind} limit ${Math.round(
                MEDIA_MAX_BYTES_BY_KIND[kind] / 1024 / 1024,
              )} MB).`,
            );
            continue;
          }
          try {
            const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
            setItems((prev) => [...prev, { type: kind, mediaUrl: publicUrl, path }]);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Upload failed.");
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [items.length],
  );

  const removeItem = useCallback(
    (idx: number) => {
      setItems((prev) => {
        const it = prev[idx];
        if (it) gc(it.path);
        return prev.filter((_, i) => i !== idx);
      });
    },
    [gc],
  );

  const send = useCallback(async () => {
    if (items.length < 2) {
      toast.error("An album needs at least 2 photos/videos.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/whatsapp/send-album", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          items: items.map((i) => ({ type: i.type, media_url: i.mediaUrl })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Send failed");
        return;
      }
      toast.success(`Album sent (${items.length})`);
      // Items are now owned by the sent messages — clear without GC.
      setItems([]);
      onClose();
    } catch {
      toast.error("Send failed");
    } finally {
      setSending(false);
    }
  }, [items, conversationId, onClose]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Images className="h-4 w-4" /> Send album
          </DialogTitle>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            void handlePick(e.target.files);
            e.target.value = "";
          }}
        />

        {items.length === 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            Add photos & videos
          </button>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {items.map((it, idx) => (
              <div key={it.path} className="group relative aspect-square overflow-hidden rounded-md bg-muted">
                {it.type === "video" ? (
                  <video src={it.mediaUrl} className="h-full w-full object-cover" muted />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.mediaUrl} alt="" className="h-full w-full object-cover" />
                )}
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  aria-label="Remove"
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {items.length < MAX_ITEMS && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-foreground disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </button>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={send} disabled={sending || busy || items.length < 2}>
            {sending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Send{items.length >= 2 ? ` (${items.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
