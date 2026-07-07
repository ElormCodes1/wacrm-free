"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

const BG_COLORS = ["#0f766e", "#1e3a8a", "#7c3aed", "#b91c1c", "#c2410c", "#334155"];

type Tab = "text" | "image" | "video";

/**
 * Post to WhatsApp Status (Stories) — text, image URL, or video URL,
 * visible to all contacts. Calls onPosted() so the Status page can refresh.
 */
export function StatusComposer({ onPosted }: { onPosted?: () => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("text");
  const [text, setText] = useState("");
  const [bg, setBg] = useState(BG_COLORS[0]);
  const [mediaUrl, setMediaUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);

  function reset() {
    setText("");
    setMediaUrl("");
    setCaption("");
  }

  async function post() {
    const payload =
      tab === "text"
        ? { type: "text", content: text.trim(), backgroundColor: bg }
        : { type: tab, content: mediaUrl.trim(), caption: caption.trim() || undefined };
    if (!payload.content) {
      toast.error(tab === "text" ? "Enter some text." : `Enter a ${tab} URL.`);
      return;
    }
    setPosting(true);
    try {
      const res = await fetch("/api/whatsapp/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Post failed");
        return;
      }
      toast.success("Posted to WhatsApp Status");
      setOpen(false);
      reset();
      onPosted?.();
    } catch {
      toast.error("Post failed");
    } finally {
      setPosting(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New status
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Post to WhatsApp Status</DialogTitle>
          </DialogHeader>

          <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
            {(["text", "image", "video"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 rounded-md py-1.5 capitalize ${tab === t ? "bg-background shadow-sm" : "text-muted-foreground"}`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "text" ? (
            <div className="space-y-3">
              <div
                className="flex min-h-24 items-center justify-center rounded-lg p-4 text-center text-lg font-medium text-white"
                style={{ background: bg }}
              >
                {text || "Your status…"}
              </div>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What's on your mind?"
                rows={3}
              />
              <div className="flex gap-2">
                {BG_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setBg(c)}
                    aria-label={`Background ${c}`}
                    className={`size-7 rounded-full border-2 ${bg === c ? "border-foreground" : "border-transparent"}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label htmlFor="statusmedia">{tab === "image" ? "Image URL" : "Video URL"}</Label>
                <Input
                  id="statusmedia"
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                  placeholder={tab === "image" ? "https://…/promo.jpg" : "https://…/clip.mp4"}
                />
              </div>
              <div>
                <Label htmlFor="statuscap">Caption (optional)</Label>
                <Input
                  id="statuscap"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="20% off this week"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={posting}>
              Cancel
            </Button>
            <Button onClick={post} disabled={posting}>
              {posting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
