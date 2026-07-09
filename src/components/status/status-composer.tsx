"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Upload, Mic, Square, X } from "lucide-react";
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

// Client-side Ogg/Opus encoder (vendored into /public, reused from the inbox
// composer). WhatsApp renders Ogg/Opus as a playable voice note.
const OPUS_ENCODER_PATH = "/opus/encoderWorker.min.js";
const MAX_RECORD_SECONDS = 5 * 60;

type Tab = "text" | "image" | "video" | "audio";

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
 * Post to WhatsApp Status (Stories) — text, an uploaded/linked image or
 * video, or a voice note (recorded or uploaded), from a chosen connected
 * number. Calls onPosted().
 */
export function StatusComposer({
  onPosted,
  open: openProp,
  onOpenChange,
  showTrigger = true,
}: {
  onPosted?: () => void;
  /** Optional controlled open state (e.g. opened from the "My status" tile). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the built-in "New status" button when the parent opens the composer. */
  showTrigger?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
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

  // Voice recording state (opus-recorder).
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<import("opus-recorder").default | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

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

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  // Tear down a live recording on unmount / dialog close so the mic isn't leaked.
  useEffect(() => {
    if (!open) {
      clearTimer();
      void recorderRef.current?.stop().catch(() => {});
      setRecording(false);
    }
    return () => {
      clearTimer();
      void recorderRef.current?.stop().catch(() => {});
    };
  }, [open, clearTimer]);

  function reset() {
    setText("");
    setMediaUrl("");
    setMediaName("");
    setCaption("");
    setRecordSeconds(0);
  }

  async function uploadFile(file: File, kind: "image" | "video" | "audio") {
    const cap = MEDIA_MAX_BYTES_BY_KIND[kind];
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

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    await uploadFile(file, tab === "video" ? "video" : tab === "audio" ? "audio" : "image");
  }

  // ---- Voice recording ----
  const finalizeRecording = useCallback(async (bytes: Uint8Array) => {
    const file = new File([bytes as unknown as BlobPart], `voice-${Date.now()}.ogg`, {
      type: "audio/ogg",
    });
    if (file.size === 0) return; // cancelled / empty take
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.audio) {
      toast.error("Recording is too long (over 16 MB).");
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
  }, []);

  const startRecording = useCallback(async () => {
    if (recording || uploading) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      toast.error("Voice recording isn't supported in this browser.");
      return;
    }
    try {
      const { default: Recorder } = await import("opus-recorder");
      const recorder = new Recorder({
        encoderPath: OPUS_ENCODER_PATH,
        numberOfChannels: 1,
        encoderApplication: 2048, // VOIP — tuned for speech
        encoderSampleRate: 48000,
        streamPages: false,
      });
      cancelledRef.current = false;
      recorder.ondataavailable = (bytes) => {
        if (cancelledRef.current) return;
        void finalizeRecording(bytes);
      };
      recorderRef.current = recorder;
      await recorder.start();
      setMediaUrl("");
      setMediaName("");
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      void recorderRef.current?.stop().catch(() => {});
      recorderRef.current = null;
      toast.error("Microphone access denied or unavailable.");
    }
  }, [recording, uploading, finalizeRecording]);

  const stopRecording = useCallback(() => {
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
    setRecording(false);
    setRecordSeconds(0);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  // Auto-stop at the cap.
  useEffect(() => {
    if (recording && recordSeconds >= MAX_RECORD_SECONDS) stopRecording();
  }, [recording, recordSeconds, stopRecording]);

  async function post() {
    let payload: Record<string, unknown>;
    if (tab === "text") {
      payload = { type: "text", content: text.trim(), backgroundColor: bg, font, configId };
    } else if (tab === "audio") {
      payload = { type: "audio", content: mediaUrl.trim(), configId };
    } else {
      payload = { type: tab, content: mediaUrl.trim(), caption: caption.trim() || undefined, configId };
    }
    if (!payload.content) {
      toast.error(
        tab === "text"
          ? "Enter some text."
          : tab === "audio"
            ? "Record or upload a voice note."
            : `Upload or link a ${tab}.`,
      );
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
      {showTrigger && (
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          New status
        </Button>
      )}
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
            {(["text", "image", "video", "audio"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 rounded-md py-1.5 capitalize ${tab === t ? "bg-background shadow-sm" : "text-muted-foreground"}`}
              >
                {t === "audio" ? "Voice" : t}
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
          ) : tab === "audio" ? (
            <div className="space-y-3">
              {mediaUrl && !recording && (
                <audio src={mediaUrl} controls className="w-full" />
              )}

              {recording ? (
                <div className="flex items-center gap-3 rounded-lg border p-3">
                  <span className="relative flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
                  </span>
                  <span className="flex-1 text-sm tabular-nums">
                    Recording… {Math.floor(recordSeconds / 60)}:
                    {String(recordSeconds % 60).padStart(2, "0")}
                  </span>
                  <Button type="button" size="sm" variant="outline" onClick={cancelRecording}>
                    <X className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="sm" onClick={stopRecording}>
                    <Square className="mr-1 h-3.5 w-3.5" />
                    Stop
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    disabled={uploading}
                    onClick={startRecording}
                  >
                    <Mic className="mr-1 h-4 w-4" />
                    {mediaName?.startsWith("voice-") ? "Re-record" : "Record"}
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={onPickFile}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-1 h-4 w-4" />
                    )}
                    Upload
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
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
            <Button onClick={post} disabled={posting || uploading || recording}>
              {posting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
