"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { formatLastSeen } from "@/lib/presence";

/** Baileys `lastKnownPresence`, stored verbatim in contact_presence.state. */
type PresenceState =
  | "available"
  | "unavailable"
  | "composing"
  | "recording"
  | "paused";

interface PresenceRow {
  state: PresenceState;
  last_seen: string | null;
  updated_at: string;
}

/** A typing/recording ping older than this is no longer treated as live —
 *  guards against a dropped `paused`/`available` follow-up pinning the
 *  indicator on forever. */
const TYPING_TTL_MS = 10_000;

/** An `available`/`paused` row older than this is treated as unknown
 *  (falls back to the phone number) rather than a stuck "online" — some
 *  clients go quiet without emitting `unavailable`. */
const ONLINE_TTL_MS = 60_000;

/** How often to re-derive locally so typing/online expire on the clock
 *  even when no new event arrives. */
const RE_DERIVE_MS = 4_000;

export type ContactPresence =
  | { kind: "typing"; label: string }
  | { kind: "online"; label: string }
  | { kind: "lastseen"; label: string };

/**
 * Live WhatsApp presence for a single contact — "typing…", "online", or
 * "last seen …". Subscribes to the contact_presence Realtime feed the
 * webhook writes (Evolution forwards Baileys' presence.update, which it
 * auto-subscribes to when the contact messages us). Returns null when
 * there's no usable presence, so the caller falls back to the phone number.
 */
export function useContactPresence(
  contactId: string | undefined,
  isGroup: boolean | null | undefined,
): ContactPresence | null {
  const [row, setRow] = useState<PresenceRow | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Groups don't report a single presence; skip them entirely.
  const enabled = Boolean(contactId) && !isGroup;

  useEffect(() => {
    // When disabled (no contact / a group), don't subscribe. The prior
    // run's cleanup already reset `row`, so nothing to do here.
    if (!enabled || !contactId) return;
    const supabase = createClient();
    let active = true;

    // Seed with the current row so presence shows immediately on open,
    // not only after the next event.
    void supabase
      .from("contact_presence")
      .select("state, last_seen, updated_at")
      .eq("contact_id", contactId)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data) setRow(data as PresenceRow);
      });

    const channel = supabase
      .channel(`contact-presence:${contactId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "contact_presence",
          filter: `contact_id=eq.${contactId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") setRow(null);
          else setRow(payload.new as PresenceRow);
        },
      )
      .subscribe();
    channelRef.current = channel;

    return () => {
      active = false;
      void supabase.removeChannel(channel);
      channelRef.current = null;
      setRow(null);
    };
  }, [enabled, contactId]);

  // Local clock tick so a "typing…"/"online" state expires without a new
  // event. Only runs while there's a row to age.
  useEffect(() => {
    if (!row) return;
    const t = setInterval(() => setNow(Date.now()), RE_DERIVE_MS);
    return () => clearInterval(t);
  }, [row]);

  if (!row) return null;

  const age = now - new Date(row.updated_at).getTime();

  if (
    (row.state === "composing" || row.state === "recording") &&
    age < TYPING_TTL_MS
  ) {
    return {
      kind: "typing",
      label: row.state === "recording" ? "recording audio…" : "typing…",
    };
  }

  // Present (or a typing ping that just aged out — they were online) and
  // recent enough to trust.
  if (
    (row.state === "available" ||
      row.state === "paused" ||
      row.state === "composing" ||
      row.state === "recording") &&
    age < ONLINE_TTL_MS
  ) {
    return { kind: "online", label: "online" };
  }

  if (row.state === "unavailable" && row.last_seen) {
    return { kind: "lastseen", label: `last seen ${formatLastSeen(row.last_seen, now)}` };
  }

  return null;
}
