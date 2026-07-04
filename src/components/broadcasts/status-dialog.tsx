"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Radio } from "lucide-react";
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

/**
 * Post to WhatsApp Status (Stories) — text or an image URL, visible to all
 * contacts. No per-contact send.
 */
export function StatusDialog() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"text" | "image">("text");
  const [text, setText] = useState("");
  const [bg, setBg] = useState(BG_COLORS[0]);
  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);

  async function post() {
    const payload =
      tab === "text"
        ? { type: "text", content: text.trim(), backgroundColor: bg }
        : { type: "image", content: imageUrl.trim(), caption: caption.trim() || undefined };
    if (!payload.content) {
      toast.error(tab === "text" ? "Enter some text." : "Enter an image URL.");
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
      setText("");
      setImageUrl("");
      setCaption("");
    } catch {
      toast.error("Post failed");
    } finally {
      setPosting(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Radio className="h-4 w-4" />
        Post Status
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Post to WhatsApp Status</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
          {(["text", "image"] as const).map((t) => (
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
              <Label htmlFor="statusimg">Image URL</Label>
              <Input
                id="statusimg"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://…/promo.jpg"
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
