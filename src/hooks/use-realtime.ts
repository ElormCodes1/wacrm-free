"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message, Conversation } from "@/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface RealtimeEvent<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
}

interface UseRealtimeOptions {
  channelName: string;
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
  enabled?: boolean;
  /**
   * Scope the subscription to one tenant.
   *
   * Without it these bindings watch EVERY row in the table and rely on
   * row-level security to discard what this user may not see — which
   * means Realtime evaluates policies per subscriber, per row. The cost
   * then grows with how many customers are signed in rather than with how
   * busy any one of them is, so a quiet tenant pays for everyone else
   * being online.
   *
   * Null is treated as "not ready yet" and nothing is subscribed:
   * subscribing unfiltered while the account id loads would reintroduce
   * exactly the fan-out this exists to avoid, on every page load.
   */
  accountId?: string | null;
}

/**
 * Whether the tenant filter on `messages` works against this database.
 *
 * The filter needs `messages.account_id`, added by migration 085. If the
 * code is deployed before that migration is applied — which happened, and
 * took live inboxes silent until it was noticed — Realtime cannot bind a
 * filter to a column that does not exist and the subscription errors. The
 * inbox then receives nothing, with no failure anyone would see except
 * messages quietly not arriving.
 *
 * So a bind failure downgrades to the unfiltered subscription for the
 * rest of the page's life: less efficient, which is a cost, versus not
 * working at all, which is not a trade. Module-level, so one tab probes
 * once rather than on every remount, and a reload picks up the migration
 * the moment it lands.
 *
 * This matters beyond our own deploy order — this project is self-hosted
 * by others, who will apply migrations on their own schedule.
 */
let messagesFilterSupported = true;

export function useRealtime({
  channelName,
  onMessageEvent,
  onConversationEvent,
  enabled = true,
  accountId,
}: UseRealtimeOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  // Bumped to re-run the effect after a filtered bind fails, so the
  // fallback subscription is opened immediately rather than on the next
  // navigation.
  const [bindAttempt, setBindAttempt] = useState(0);

  // Store latest callbacks in refs to avoid re-subscribing when the
  // parent re-renders with fresh closures. Assigned inside an effect
  // so the mutation doesn't happen during render (React 19's refs
  // rule) — subscribers only read `.current` inside async Realtime
  // callbacks, which always run after the render that updates it.
  const onMessageRef = useRef(onMessageEvent);
  const onConversationRef = useRef(onConversationEvent);
  useEffect(() => {
    onMessageRef.current = onMessageEvent;
    onConversationRef.current = onConversationEvent;
  });

  useEffect(() => {
    if (!enabled) return;
    // Wait for the tenant before opening anything. See `accountId`.
    if (accountId === null || accountId === undefined) return;

    const supabase = createClient();

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          // messages carries a denormalised account_id purely so this
          // filter is possible — postgres_changes cannot follow
          // conversation_id to the parent. See migration 085, and
          // messagesFilterSupported above for what happens without it.
          ...(messagesFilterSupported
            ? { filter: `account_id=eq.${accountId}` }
            : {}),
        },
        (payload) => {
          onMessageRef.current?.({
            eventType: payload.eventType as RealtimeEvent<Message>["eventType"],
            new: payload.new as Message,
            old: payload.old as Partial<Message>,
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          onConversationRef.current?.({
            eventType: payload.eventType as RealtimeEvent<Conversation>["eventType"],
            new: payload.new as Conversation,
            old: payload.old as Partial<Conversation>,
          });
        }
      )
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");

        // A bind error while filtered almost always means the column is
        // missing. Retry unfiltered rather than leave the inbox silent.
        if (status === "CHANNEL_ERROR" && messagesFilterSupported) {
          console.warn(
            "[realtime] tenant-filtered subscription failed — falling back to " +
              "unfiltered. Apply migration 085 (messages.account_id) to restore it.",
          );
          messagesFilterSupported = false;
          setBindAttempt((n) => n + 1);
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      setIsConnected(false);
    };
  }, [channelName, enabled, accountId, bindAttempt]);

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      const supabase = createClient();
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
      setIsConnected(false);
    }
  }, []);

  return { isConnected, unsubscribe };
}
