"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Upload } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { uploadAccountMedia, MEDIA_MAX_BYTES_BY_KIND } from "@/lib/storage/upload-media";

const BG_COLORS = ["#0f766e", "#1e3a8a", "#7c3aed", "#b91c1c", "#c2410c", "#334155"];

// WhatsApp text-status fonts. Evolution requires a truthy font (its check
// is `if (!font)`), so values are 1-5 — 0 is rejected as "missing". css is
// an approximation for the composer preview only.
const FONTS: { value: number; label: string; css: string }[] = [
  { value: 1, label: "Serif", css: "Georgia, serif" },
  { value: 2, label: "Script", css: "'Brush Script MT', cursive" },
  { value: 3, label: "Mono", css: "ui-monospace, monospace" },
  { value: 4, label: "Sans", css: "system-ui, sans-serif" },
  { value: 5, label: "Cond.", css: "'Arial Narrow', sans-serif" },
];

type Tab = "text" | "image" | "video";

interface WaNumber {
  id: string;
  label: string | null;
  connection_state: string;
  phone_info: { display_phone_number: string | null; verified_name: string | null } | null;
}

function numberLabel(n: WaNumber): string {
  return (
    n.label ||
    n.phone_info?.verified_name ||
    n.phone_info?.display_phone_number ||
    "WhatsApp number"
  );
}

/**
 * Post to WhatsApp Status (Stories) — text, an uploaded/linked image, or an
 * uploaded/linked video, from a chosen connected number. Calls onPosted().
 */
export function StatusComposer({ onPosted }: { onPosted?: () => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("text");
  const [text, setText] = useState("");
  const [bg, setBg] = useState(BG_COLORS[0]);
  const [font, setFont] = useState(1);
  const fontCss = (FONTS.find((f) => f.value === font) ?? FONTS[0]).css;
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaName, setMediaName] = useState("");
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [numbers, setNumbers] = useState<WaNumber[]>([]);
  const [configId, setConfigId] = useState<string>("");
  const openNumbers = numbers.filter((n) => n.connection_state === "open");

  // Load connected numbers when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/whatsapp/config");
        const data = await res.json();
        if (cancelled || !res.ok) return;
        const nums: WaNumber[] = data.numbers ?? [];
        setNumbers(nums);
        const firstOpen = nums.find((n) => n.connection_state === "open");
        if (firstOpen) setConfigId((cur) => cur || firstOpen.id);
      } catch {
        /* selector just won't show; post falls back to default number */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  function reset() {
    setText("");
    setMediaUrl("");
    setMediaName("");
    setCaption("");
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    const cap = tab === "video" ? MEDIA_MAX_BYTES_BY_KIND.video : MEDIA_MAX_BYTES_BY_KIND.image;
    if (file.size > cap) {
      toast.error(`File too large (max ${Math.round(cap / 1024 / 1024)} MB).`);
      return;
    }
    setUploading(true);
    try {
      const { publicUrl } = await uploadAccountMedia("chat-media", file);
      setMediaUrl(publicUrl);
      setMediaName(file.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function post() {
    const payload =
      tab === "text"
        ? { type: "text", content: text.trim(), backgroundColor: bg, font, configId }
        : { type: tab, content: mediaUrl.trim(), caption: caption.trim() || undefined, configId };
    if (!payload.content) {
      toast.error(tab === "text" ? "Enter some text." : `Upload or link a ${tab}.`);
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

          {/* Post-from number selector (only when >1 connected) */}
          {openNumbers.length > 1 && (
            <div className="space-y-1.5">
              <Label>Post from</Label>
              <Select value={configId} onValueChange={(v) => setConfigId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a number" />
                </SelectTrigger>
                <SelectContent>
                  {openNumbers.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {numberLabel(n)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
                style={{ background: bg, fontFamily: fontCss }}
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
              <div className="flex flex-wrap gap-1.5">
                {FONTS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFont(f.value)}
                    style={{ fontFamily: f.css }}
                    className={`rounded-md border px-2 py-1 text-xs ${
                      font === f.value
                        ? "border-foreground bg-muted"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Preview when a media URL is set */}
              {mediaUrl &&
                (tab === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl}
                    alt=""
                    className="max-h-40 w-full rounded-lg object-contain"
                  />
                ) : (
                  <video src={mediaUrl} className="max-h-40 w-full rounded-lg" controls />
                ))}

              {/* Upload from device */}
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept={tab === "image" ? "image/*" : "video/*"}
                  className="hidden"
                  onChange={onPickFile}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-1 h-4 w-4" />
                  )}
                  {mediaName ? `Change ${tab}` : `Upload ${tab} from device`}
                </Button>
                {mediaName && (
                  <p className="mt-1 truncate text-xs text-muted-foreground">{mediaName}</p>
                )}
              </div>

              {/* Or paste a link */}
              <div>
                <Label htmlFor="statusmedia" className="text-xs text-muted-foreground">
                  …or paste a {tab} link
                </Label>
                <Input
                  id="statusmedia"
                  value={mediaName ? "" : mediaUrl}
                  onChange={(e) => {
                    setMediaUrl(e.target.value);
                    setMediaName("");
                  }}
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
            <Button onClick={post} disabled={posting || uploading}>
              {posting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
