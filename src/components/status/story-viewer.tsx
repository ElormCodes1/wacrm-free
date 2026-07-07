"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { StatusItem } from "./types";

export interface ViewerGroup {
  key: string;
  name: string;
  avatar_url: string | null;
  isMine?: boolean;
  items: StatusItem[];
}

const IMAGE_TEXT_DURATION_MS = 5000;

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

/**
 * Full-screen WhatsApp-style story viewer. Auto-advances through a poster's
 * items (5s for image/text, video length for video), then on to the next
 * group. Tap/click left third to go back, right to go forward. Marks each
 * shown (non-mine) item viewed via onViewed.
 */
export function StoryViewer({
  groups,
  startIndex,
  onClose,
  onViewed,
}: {
  groups: ViewerGroup[];
  startIndex: number;
  onClose: () => void;
  onViewed: (id: string) => void;
}) {
  const [groupIndex, setGroupIndex] = useState(startIndex);
  const [itemIndex, setItemIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const group = groups[groupIndex];
  const item = group?.items[itemIndex];

  const next = useCallback(() => {
    setProgress(0);
    setItemIndex((curItem) => {
      if (group && curItem < group.items.length - 1) return curItem + 1;
      // Move to next group, else close.
      setGroupIndex((curGroup) => {
        if (curGroup < groups.length - 1) return curGroup + 1;
        onClose();
        return curGroup;
      });
      return group && curItem < group.items.length - 1 ? curItem + 1 : 0;
    });
  }, [group, groups.length, onClose]);

  const prev = useCallback(() => {
    setProgress(0);
    setItemIndex((curItem) => {
      if (curItem > 0) return curItem - 1;
      let handled = curItem;
      setGroupIndex((curGroup) => {
        if (curGroup > 0) {
          handled = groups[curGroup - 1].items.length - 1;
          return curGroup - 1;
        }
        return curGroup;
      });
      return handled;
    });
  }, [groups]);

  // Mark the current item viewed (once shown).
  useEffect(() => {
    if (item && !group?.isMine && !item.viewed_at) onViewed(item.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupIndex, itemIndex]);

  // Auto-advance timer for image/text. Video drives its own progress.
  useEffect(() => {
    if (!item || item.content_type === "video") return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / IMAGE_TEXT_DURATION_MS);
      setProgress(p);
      if (p >= 1) next();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupIndex, itemIndex]);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  if (!group || !item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95">
      {/* Progress bars */}
      <div className="absolute inset-x-0 top-0 z-20 flex gap-1 p-3">
        {group.items.map((it, i) => (
          <div key={it.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
            <div
              className="h-full bg-white transition-[width] duration-100 ease-linear"
              style={{
                width: i < itemIndex ? "100%" : i === itemIndex ? `${progress * 100}%` : "0%",
              }}
            />
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="absolute inset-x-0 top-4 z-20 flex items-center gap-3 px-4 pt-2">
        <Avatar size="default">
          {group.avatar_url && <AvatarImage src={group.avatar_url} alt={group.name} />}
          <AvatarFallback>{initials(group.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">
            {group.isMine ? "My status" : group.name}
          </p>
          <p className="text-xs text-white/60">{timeAgo(item.posted_at)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Media */}
      <div className="relative flex h-full w-full max-w-lg items-center justify-center">
        {item.content_type === "text" ? (
          <div
            className="flex h-full w-full items-center justify-center p-8 text-center text-2xl font-medium text-white"
            style={{ background: item.background_color || "#334155" }}
          >
            {item.content_text}
          </div>
        ) : item.content_type === "video" ? (
          item.media_url ? (
            <video
              ref={videoRef}
              src={item.media_url}
              className="max-h-full max-w-full"
              autoPlay
              playsInline
              onEnded={next}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                if (v.duration) setProgress(v.currentTime / v.duration);
              }}
            />
          ) : (
            <p className="text-white/60">Video unavailable</p>
          )
        ) : item.content_type === "audio" ? (
          item.media_url ? (
            <audio src={item.media_url} controls autoPlay className="w-4/5" onEnded={next} />
          ) : (
            <p className="text-white/60">Audio unavailable</p>
          )
        ) : item.media_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.media_url} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <p className="text-white/60">Image unavailable</p>
        )}

        {/* Caption */}
        {item.content_text && item.content_type !== "text" && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-6 pb-10 text-center text-sm text-white">
            {item.content_text}
          </div>
        )}

        {/* Tap zones */}
        <button
          type="button"
          aria-label="Previous"
          onClick={prev}
          className="group absolute inset-y-0 left-0 w-1/3 focus:outline-none"
        >
          <ChevronLeft className="ml-2 h-6 w-6 text-white/0 group-hover:text-white/50" />
        </button>
        <button
          type="button"
          aria-label="Next"
          onClick={next}
          className="group absolute inset-y-0 right-0 flex w-2/3 items-center justify-end focus:outline-none"
        >
          <ChevronRight className="mr-2 h-6 w-6 text-white/0 group-hover:text-white/50" />
        </button>
      </div>
    </div>
  );
}
