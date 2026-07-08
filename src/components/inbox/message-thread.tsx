"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { usePresence } from "@/hooks/use-presence";
import { useContactPresence } from "@/hooks/use-contact-presence";
import { PresenceDot } from "@/components/presence/presence-dot";
import { presenceLabel } from "@/lib/presence";
import { cn } from "@/lib/utils";
import { contactDisplayName as resolveDisplayName } from "@/lib/inbox/contact-name";
import type {
  Conversation,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
  MessageTemplate,
  Profile,
} from "@/types";
import {
  MessageSquare,
  ChevronDown,
  UserPlus,
  Check,
  ArrowLeft,
  RefreshCw,
  PanelRightOpen,
  PanelRightClose,
  MoreVertical,
  Archive,
  MailOpen,
  Ban,
  EyeOff,
  Eye,
  ListTodo,
  Pin,
  PinOff,
  Bell,
  BellOff,
  Search,
  ChevronUp,
  X,
  Trash2,
  Eraser,
  Users,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageBubble } from "./message-bubble";
import { MessageActions } from "./message-actions";
import { ForwardDialog } from "./forward-dialog";
import {
  MessageComposer,
  CHAT_MEDIA_BUCKET,
  type SendMediaPayload,
} from "./message-composer";
import { deleteAccountMedia } from "@/lib/storage/upload-media";
import { TemplatePicker } from "./template-picker";
import { buildReplyPreview } from "./reply-quote";
import { toast } from "sonner";

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}

interface MessageThreadProps {
  conversation: Conversation | null;
  contact: Contact | null;
  messages: Message[];
  onMessagesLoaded: (messages: Message[]) => void;
  onNewMessage: (message: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onStatusChange: (conversationId: string, status: ConversationStatus) => void;
  onAssignChange: (
    conversationId: string,
    assignedAgentId: string | null,
  ) => void;
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  /**
   * Increment to force the messages + reactions fetch effects to refire.
   * Parent bumps this on realtime reconnect / tab visibility → visible
   * so the open thread catches up on any events sent while the WS was
   * disconnected or the tab was throttled. Optional so existing callers
   * keep working.
   */
  resyncToken?: number;
  /**
   * Fired by the manual-refresh button in the thread header. The parent
   * typically bumps the same `resyncToken` it controls — this gives the
   * user a way to force a refetch when they suspect realtime missed an
   * event (or they're impatient). Optional so existing callers keep
   * working; the button is only rendered when this is provided.
   */
  onRefresh?: () => void;
  /**
   * Desktop-only contact-panel toggle. The page owns the open/closed
   * state (it's the one that renders the sidebar), so the thread just
   * reflects it and asks the page to flip it. Both optional so existing
   * callers keep working; the toggle button only renders when
   * `onToggleContactPanel` is wired up.
   */
  contactPanelOpen?: boolean;
  onToggleContactPanel?: () => void;
  /**
   * Mobile/tablet (<xl): opens the contact panel in a drawer, since the
   * static desktop panel is hidden there. The page owns the drawer.
   */
  onOpenContactSheet?: () => void;
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMMM d, yyyy");
}

function groupMessagesByDate(messages: Message[]) {
  const groups: { date: string; messages: Message[] }[] = [];
  let currentDate = "";

  for (const msg of messages) {
    const day = format(new Date(msg.created_at), "yyyy-MM-dd");
    if (day !== currentDate) {
      currentDate = day;
      groups.push({ date: msg.created_at, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }

  return groups;
}

const STATUS_OPTIONS: { label: string; value: ConversationStatus; color: string }[] = [
  { label: "Open", value: "open", color: "text-primary" },
  { label: "Pending", value: "pending", color: "text-amber-400" },
  { label: "Closed", value: "closed", color: "text-muted-foreground" },
];

/**
 * WhatsApp-style doodle background applied to the chat area (both the
 * active thread and the empty state). The SVG tile lives at
 * `/public/inbox-doodle.svg`; the slate-950 colour sits underneath so
 * the doodles read as a subtle pattern rather than a stark grid.
 *
 * Defined once at module scope so the two render paths can't drift —
 * if we ever switch the asset, both spots update together.
 */
const DOODLE_BG_CLASSES =
  "bg-chat-wallpaper bg-[url('/inbox-doodle.svg')] bg-repeat";

export function MessageThread({
  conversation,
  contact,
  messages,
  onMessagesLoaded,
  onNewMessage,
  onUpdateMessage,
  onStatusChange,
  onAssignChange,
  onBack,
  resyncToken = 0,
  onRefresh,
  contactPanelOpen,
  onToggleContactPanel,
  onOpenContactSheet,
}: MessageThreadProps) {
  const { user } = useAuth();
  const { getPresence, getRow, now } = usePresence();
  // Live WhatsApp presence for the person on the other end (typing…/
  // online/last seen), distinct from the CRM-teammate presence above.
  const contactPresence = useContactPresence(contact?.id, contact?.is_group);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [forwardMsgId, setForwardMsgId] = useState<string | null>(null);
  // Purely visual spin state for the manual-refresh button. The actual
  // refetch is fire-and-forget through `onRefresh` (which bumps the
  // parent's resyncToken); the 700ms spin is just feedback so the click
  // doesn't feel like a no-op. Cleared via the timer ref on unmount.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);
  const handleRefreshClick = useCallback(() => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    onRefresh();
    refreshTimerRef.current = setTimeout(() => {
      setIsRefreshing(false);
      refreshTimerRef.current = null;
    }, 700);
  }, [isRefreshing, onRefresh]);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);

  // In-conversation search.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);

  // Profiles are bounded by RLS to rows the current user is allowed to
  // see — today that's just the current user, but the dropdown keeps the
  // shape ready for shared-team workspaces without a refactor.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .order("full_name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch profiles:", error);
          return;
        }
        setProfiles((data as Profile[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // NOTE: Meta's Cloud API enforced a 24-hour customer-service window
  // (free-form messages only within 24h of the customer's last message,
  // else an approved template). The self-hosted Evolution/Baileys backend
  // has NO such window — agents can message anytime — so the timer/badge
  // and the composer's "session expired" gate have been removed.

  // Store latest callback in a ref so fetchMessages doesn't need to
  // depend on `onMessagesLoaded` — otherwise parent re-renders cause
  // fetchMessages to change → useEffect re-fires → refetch → realtime
  // UPDATE on conversations.unread_count → parent re-renders → LOOP.
  // The ref is written inside an effect so the mutation doesn't happen
  // during render (React 19 refs rule); consumers only read `.current`
  // inside the async fetch completion, which runs after the render.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  });

  const conversationId = conversation?.id;
  const hasUnread = (conversation?.unread_count ?? 0) > 0;

  // Fetch messages whenever the selected conversation changes. Kept
  // separate from the unread-reset effect so that incoming messages
  // arriving while the thread is open don't trigger a full refetch —
  // they only flip hasUnread, which only the reset effect listens to.
  useEffect(() => {
    if (!conversationId) return;

    const supabase = createClient();
    let cancelled = false;

    (async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("Failed to fetch messages:", error);
      } else {
        onMessagesLoadedRef.current(data ?? []);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus —
    // realtime is best-effort and any message events sent while the WS
    // was disconnected or throttled are otherwise lost.
  }, [conversationId, resyncToken]);

  // Reactions fetch — pulls the current state from the DB. Kept separate
  // from the channel subscription below so a `resyncToken` bump just
  // refetches the rows without also tearing down and rebuilding the
  // realtime channel.
  useEffect(() => {
    if (!conversationId) {
      setReactions([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("message_reactions")
        .select("*")
        .eq("conversation_id", conversationId);
      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch reactions:", error);
        return;
      }
      setReactions((data as MessageReaction[]) ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, resyncToken]);

  // Reactions realtime subscription per conversation. Subscribing here
  // (not at the page level) keeps the channel scoped to the visible
  // conversation and avoids cross-conversation chatter on a busy inbox.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            // Swap any matching optimistic temp row for the real one so
            // the pill doesn't double up after a successful POST.
            const tempIdx = prev.findIndex(
              (r) =>
                r.id.startsWith("temp-") &&
                r.message_id === row.message_id &&
                r.actor_type === row.actor_type &&
                r.actor_id === row.actor_id,
            );
            if (tempIdx >= 0) {
              const copy = prev.slice();
              copy[tempIdx] = row;
              return copy;
            }
            return [...prev, row];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => prev.map((r) => (r.id === row.id ? row : r)));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>;
          if (!old?.id) return;
          setReactions((prev) => prev.filter((r) => r.id !== old.id));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Clear any in-progress reply draft when the active conversation changes —
  // a quote pulled from conversation A shouldn't bleed into conversation B.
  useEffect(() => {
    setReplyTo(null);
  }, [conversationId]);

  // Reset the server-side unread_count to 0 whenever an unread count
  // surfaces on the active conversation — covers both (a) opening a
  // conversation that had unread messages and (b) new messages arriving
  // while the user is already viewing the thread (webhook server-bumps
  // unread_count to N+1; the realtime UPDATE propagates it into the
  // client, which re-runs this effect and flips it back to 0).
  //
  // Guarding on hasUnread prevents the eq-update loop: once unread_count
  // is 0 the condition is false, so no further UPDATE is issued.
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    const supabase = createClient();
    supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId)
      .then(({ error }) => {
        if (error) console.error("Failed to reset unread_count:", error);
      });
    // Mirror the read state to WhatsApp (blue ticks for the customer).
    // Best-effort; the endpoint no-ops if WhatsApp isn't connected.
    void fetch("/api/whatsapp/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId }),
    }).catch(() => {});
  }, [conversationId, hasUnread]);

  // Whether the user is parked near the bottom of the thread. Updated from
  // the scroll handler so it reflects their position *before* a new message
  // appends — the effect below reads it to decide whether to follow.
  const nearBottomRef = useRef(true);
  const handleThreadScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  // Auto-scroll: always jump to the bottom when opening a conversation;
  // otherwise only follow appended messages when the user is already at the
  // bottom — never yank them away from history they're reading (a status
  // tick or reaction must not scroll the thread).
  const prevConvIdRef = useRef<string | undefined>(undefined);
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const convChanged = prevConvIdRef.current !== conversationId;
    const appended = messages.length > prevMsgCountRef.current;
    prevConvIdRef.current = conversationId;
    prevMsgCountRef.current = messages.length;
    if (convChanged || (appended && nearBottomRef.current)) {
      el.scrollTop = el.scrollHeight;
      nearBottomRef.current = true;
    }
  }, [messages, conversationId]);

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;

      // Optimistic update — shows the message immediately with "sending" status
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "text",
        content_text: text,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "text",
            content_text: text,
            reply_to_message_id: replyToId,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send message:", reason);
          toast.error(`Failed to send: ${reason}`);
          // Mark the optimistic bubble as failed so the user sees what happened
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        // Success — the realtime INSERT event will replace the temp bubble
        // with the real DB row. If realtime hasn't arrived yet, at least
        // flip status to 'sent' so the UI stops showing "sending".
        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send message:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, onNewMessage, onUpdateMessage]
  );

  const handleSendMedia = useCallback(
    async (payload: SendMediaPayload) => {
      if (!conversation) return;

      // Documents show their filename in our own bubble (and to the
      // recipient as the Meta caption when no caption was typed); other
      // kinds use the caption as-is. Audio carries no caption.
      const contentText =
        payload.kind === "document"
          ? payload.caption || payload.filename || "Document"
          : payload.caption;

      const tempId = `temp-${Date.now()}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        // A PTV is stored as a video (the recipient's client renders it round).
        content_type: payload.kind,
        content_text: payload.isPtv ? undefined : contentText,
        media_url: payload.mediaUrl,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: payload.replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        // Video notes go to the dedicated PTV endpoint; everything else
        // uses the shared media send.
        const res = payload.isPtv
          ? await fetch("/api/whatsapp/send-ptv", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                conversation_id: conversation.id,
                media_url: payload.mediaUrl,
                reply_to_message_id: payload.replyToId,
              }),
            })
          : await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: payload.kind,
            media_url: payload.mediaUrl,
            content_text: contentText,
            filename: payload.filename,
            reply_to_message_id: payload.replyToId,
            view_once: payload.viewOnce === true,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          console.error("Failed to send media:", reason);
          toast.error(`Failed to send: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          // The upload never reached the recipient — GC the orphaned
          // object rather than leaving it in the public bucket forever.
          void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(() => {});
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send media:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
        void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(() => {});
      }
    },
    [conversation, onNewMessage, onUpdateMessage],
  );

  const handleStatusChange = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation) return;

      const supabase = createClient();
      await supabase
        .from("conversations")
        .update({ status })
        .eq("id", conversation.id);

      onStatusChange(conversation.id, status);
    },
    [conversation, onStatusChange]
  );

  const handleOpenTemplates = useCallback(() => {
    setTemplateModalOpen(true);
  }, []);

  const handleSendTemplate = useCallback(
    async (
      template: MessageTemplate,
      values: {
        body: string[];
        headerText?: string;
        buttonParams?: Record<number, string>;
      },
    ) => {
      if (!conversation) return;

      const renderedBody = renderTemplateBody(template.body_text, values.body);
      const tempId = `temp-${Date.now()}`;

      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "template",
        content_text: renderedBody,
        template_name: template.name,
        status: "sending",
        created_at: new Date().toISOString(),
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "template",
            template_name: template.name,
            template_language: template.language,
            // Structured params drive the new send-builder path
            // (header media + URL button substitution). Body values
            // are mirrored under both shapes so the route can fall
            // back if the template row isn't found locally.
            template_message_params: {
              body: values.body,
              headerText: values.headerText,
              buttonParams: values.buttonParams,
            },
            template_params: values.body,
            content_text: renderedBody,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send template:", reason);
          toast.error(`Failed to send template: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send template:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send template: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, onNewMessage, onUpdateMessage],
  );

  // Build a quick id → Message map so reply quotes can be rendered without
  // an extra fetch — the thread already holds the full conversation.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Bucket reactions by their target message_id for O(1) per-bubble lookup.
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const bucket = map.get(r.message_id);
      if (bucket) bucket.push(r);
      else map.set(r.message_id, [r]);
    }
    return map;
  }, [reactions]);

  const contactDisplayName = contact?.name || contact?.phone || "Customer";

  // Author label for a quoted message: "You" when we sent the parent,
  // contact name when the customer sent it.
  const authorLabelFor = useCallback(
    (m: Message): string => {
      const isAgentMsg =
        m.sender_type === "agent" || m.sender_type === "bot";
      return isAgentMsg ? "You" : contactDisplayName;
    },
    [contactDisplayName],
  );

  const handleStartReply = useCallback(
    (msg: Message) => {
      setReplyTo({
        id: msg.id,
        authorLabel: authorLabelFor(msg),
        preview: buildReplyPreview(msg),
      });
    },
    [authorLabelFor],
  );

  // Edit an outbound text message (WhatsApp allows editing for ~15 min).
  const handleEditMessage = useCallback(
    async (msg: Message) => {
      const current = msg.content_text ?? "";
      const next = window.prompt("Edit message", current);
      if (next == null) return;
      const trimmed = next.trim();
      if (!trimmed || trimmed === current) return;
      try {
        const res = await fetch(`/api/whatsapp/message/${msg.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Edit failed");
          return;
        }
        toast.success("Message edited");
        onRefresh?.();
      } catch {
        toast.error("Edit failed");
      }
    },
    [onRefresh],
  );

  // Delete an outbound message for everyone (unsend).
  const handleDeleteMessage = useCallback(
    async (msg: Message) => {
      if (!window.confirm("Delete this message for everyone?")) return;
      try {
        const res = await fetch(`/api/whatsapp/message/${msg.id}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Delete failed");
          return;
        }
        toast.success("Message deleted");
        onRefresh?.();
      } catch {
        toast.error("Delete failed");
      }
    },
    [onRefresh],
  );

  // Star / unstar a message (CRM-local bookmark). Optimistic — the updated
  // array is lifted to the parent so the thread + sidebar re-render at once.
  const handleToggleStar = useCallback(
    async (msg: Message) => {
      const starred_at = msg.starred_at ? null : new Date().toISOString();
      onMessagesLoadedRef.current(
        messages.map((m) => (m.id === msg.id ? { ...m, starred_at } : m)),
      );
      const supabase = createClient();
      const { error } = await supabase
        .from("messages")
        .update({ starred_at })
        .eq("id", msg.id);
      if (error) {
        toast.error("Failed to update star");
        onMessagesLoadedRef.current(messages);
        return;
      }
      // Best-effort mirror to WhatsApp (chatModify star). Fire-and-forget.
      void fetch("/api/whatsapp/message/star", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_row_id: msg.id, star: !!starred_at }),
      });
    },
    [messages],
  );

  // Pin / unpin a message in the chat (WhatsApp pin-in-chat — visible to
  // the contact). Unlike star, WhatsApp is the source of truth here, so the
  // server route does the send + persists pinned_until; we reconcile to it.
  const handleTogglePin = useCallback(
    async (msg: Message) => {
      const isPinned = !!(msg.pinned_until && new Date(msg.pinned_until) > new Date());
      const action = isPinned ? "unpin" : "pin";
      const optimistic =
        action === "pin" ? new Date(Date.now() + 604800 * 1000).toISOString() : null;
      onMessagesLoadedRef.current(
        messages.map((m) => (m.id === msg.id ? { ...m, pinned_until: optimistic } : m)),
      );
      try {
        const res = await fetch("/api/whatsapp/message/pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_row_id: msg.id, action }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error ?? "Pin failed");
          onMessagesLoadedRef.current(messages);
          return;
        }
        onMessagesLoadedRef.current(
          messages.map((m) =>
            m.id === msg.id ? { ...m, pinned_until: data.pinned_until ?? null } : m,
          ),
        );
        toast.success(action === "pin" ? "Message pinned" : "Message unpinned");
      } catch {
        toast.error("Pin failed");
        onMessagesLoadedRef.current(messages);
      }
    },
    [messages],
  );

  // In-conversation search — ids of messages whose text contains the query,
  // in thread order. Client-side over the already-loaded messages.
  const matchIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as string[];
    return messages
      .filter((m) => (m.content_text ?? "").toLowerCase().includes(q))
      .map((m) => m.id);
  }, [searchQuery, messages]);
  const activeMatchId = matchIds.length
    ? matchIds[Math.min(matchIndex, matchIds.length - 1)]
    : null;

  // Scroll the current match into view as the user navigates.
  useEffect(() => {
    if (!activeMatchId) return;
    document
      .getElementById(`msg-${activeMatchId}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatchId]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setMatchIndex(0);
  }, []);

  const gotoMatch = useCallback(
    (dir: 1 | -1) => {
      setMatchIndex((i) => {
        const n = matchIds.length;
        return n ? (i + dir + n) % n : 0;
      });
    },
    [matchIds.length],
  );

  // Clear the connected phone's WhatsApp copy of this chat. The CRM keeps
  // its full history — this only tidies the phone.
  const handleClearChat = useCallback(async () => {
    if (!conversation) return;
    if (
      !window.confirm(
        "Clear this chat on your WhatsApp phone? It removes the messages from the connected phone's WhatsApp — your CRM history stays intact.",
      )
    )
      return;
    const res = await fetch("/api/whatsapp/conversation-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversation.id, action: "clear" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Clear failed");
      return;
    }
    toast.success("Chat cleared on WhatsApp");
  }, [conversation]);

  const handleDeleteChat = useCallback(async () => {
    if (!conversation) return;
    if (
      !window.confirm(
        "Delete this chat from the CRM? It removes the conversation and its messages here — the chat stays on WhatsApp. This can't be undone.",
      )
    )
      return;
    const res = await fetch("/api/whatsapp/conversation-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversation.id, action: "delete" }),
    });
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    toast.success("Chat deleted");
    onBack?.();
    onRefresh?.();
  }, [conversation, onBack, onRefresh]);

  const router = useRouter();

  // Open the Tasks page with the new-task dialog pre-linked to this chat.
  const createTask = useCallback(() => {
    if (!conversation) return;
    const params = new URLSearchParams({ new: "1", conversation: conversation.id });
    if (contact?.id) params.set("contact", contact.id);
    router.push(`/tasks?${params.toString()}`);
  }, [conversation, contact, router]);

  // Conversation-level actions (archive, mark unread, block).
  const conversationAction = useCallback(
    async (
      action:
        | "archive"
        | "unarchive"
        | "mark_unread"
        | "hide"
        | "unhide"
        | "pin"
        | "unpin"
        | "mute"
        | "unmute",
    ) => {
      if (!conversation) return;
      const res = await fetch("/api/whatsapp/conversation-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversation.id, action }),
      });
      if (!res.ok) {
        toast.error("Action failed");
        return;
      }
      const messages: Record<string, string> = {
        archive: "Conversation archived",
        unarchive: "Conversation unarchived",
        mark_unread: "Marked unread",
        hide: "Chat hidden",
        unhide: "Chat unhidden",
        pin: "Chat pinned",
        unpin: "Chat unpinned",
        mute: "Chat muted",
        unmute: "Chat unmuted",
      };
      toast.success(messages[action] ?? "Done");
      onRefresh?.();
    },
    [conversation, onRefresh],
  );

  const handleBlockContact = useCallback(async () => {
    if (!contact) return;
    if (!window.confirm(`Block ${contact.name || contact.phone} on WhatsApp?`)) return;
    const res = await fetch("/api/whatsapp/contact-block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_id: contact.id, block: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Block failed");
      return;
    }
    toast.success("Contact blocked");
    onRefresh?.();
  }, [contact, onRefresh]);

  // Single reaction-set primitive. emoji === "" removes; otherwise adds/swaps.
  // The "toggle" semantic (pill click) is computed at the call site where the
  // current reactions for the bubble are already in scope — keeps this
  // function dependency-free w.r.t. the reaction list.
  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id || !conversation) {
        console.warn("[reactions] missing user or conversation");
        return;
      }
      if (messageId.startsWith("temp-")) {
        toast.error("Wait for the message to finish sending");
        return;
      }

      const convId = conversation.id;
      const userId = user.id;
      let snapshot: MessageReaction[] = [];

      // Functional updater — captures the freshest reactions list, never a
      // stale closure. Snapshot stored for rollback on POST failure.
      setReactions((prev) => {
        snapshot = prev;
        const own = prev.find(
          (r) =>
            r.message_id === messageId &&
            r.actor_type === "agent" &&
            r.actor_id === userId,
        );
        if (emoji === "") return own ? prev.filter((r) => r !== own) : prev;
        if (own) return prev.map((r) => (r === own ? { ...own, emoji } : r));
        return [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            message_id: messageId,
            conversation_id: convId,
            actor_type: "agent",
            actor_id: userId,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];
      });

      try {
        const res = await fetch("/api/whatsapp/react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: messageId, emoji }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Reaction failed: ${reason}`);
        setReactions(snapshot);
      }
    },
    [conversation, user?.id],
  );

  const handleAssignChange = useCallback(
    async (agentId: string | null) => {
      if (!conversation) return;

      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update({ assigned_agent_id: agentId })
        .eq("id", conversation.id);

      if (error) {
        console.error("Failed to update assignment:", error);
        toast.error("Failed to update assignment");
        return;
      }

      onAssignChange(conversation.id, agentId);
    },
    [conversation, onAssignChange],
  );

  // Rebuilt only when the message array changes — not on every unrelated
  // re-render (presence ticks every 4s, search typing, reaction updates).
  // Must run before the early return below to satisfy rules-of-hooks.
  const messageGroups = useMemo(
    () => groupMessagesByDate(messages),
    [messages],
  );

  // Empty state — same WhatsApp-style doodle background as the active
  // thread below, so swapping between empty/selected doesn't change the
  // pattern under the user's eye.
  if (!conversation || !contact) {
    return (
      <div className={cn("flex flex-1 flex-col items-center justify-center", DOODLE_BG_CLASSES)}>
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <MessageSquare className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-sm font-medium text-muted-foreground">
          Select a conversation
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose a conversation from the left to start messaging
        </p>
      </div>
    );
  }

  const displayName = resolveDisplayName(contact);
  const currentStatus = STATUS_OPTIONS.find(
    (s) => s.value === conversation.status
  );
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const currentAssignee = profiles.find((p) => p.user_id === assignedAgentId);
  const assignLabel = assignedAgentId
    ? (currentAssignee?.full_name ?? "Assigned")
    : "Assign";

  return (
    // `min-w-0` is load-bearing: the page already puts min-w-0 on the
    // thread's flex *wrapper* (issue #165), but this root keeps the
    // default `min-width: auto`, so a single wide message (long unbroken
    // URL/word) expands the whole thread past its flex share and the chat
    // paints on top of the contact sidebar at lg+ — outgoing bubbles get
    // clipped and the hover toolbar overlaps the Tags panel. Letting the
    // root shrink lets the bubbles' break-words / max-w caps apply.
    // Issue #257.
    <div className={cn("flex min-w-0 flex-1 flex-col", DOODLE_BG_CLASSES)}>
      {/* Header — solid card surface sits on top of the doodle so the
          name/avatar/dropdowns stay legible. */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {/* Back-to-list button — mobile only. Hidden on lg+ where the
              conversation list is always visible next to the thread. */}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to conversations"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium text-foreground">
            {contact.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={contact.avatar_url}
                alt={displayName}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : contact.is_group ? (
              <Users className="h-4 w-4 text-muted-foreground" />
            ) : (
              displayName.charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{displayName}</h2>
            <div className="flex items-center gap-1.5">
              {contactPresence ? (
                <p
                  className={cn(
                    "truncate text-xs",
                    contactPresence.kind === "typing"
                      ? "text-positive"
                      : "text-muted-foreground",
                  )}
                >
                  {contactPresence.label}
                </p>
              ) : (
                <p className="truncate text-xs text-muted-foreground">
                  {contact.is_group ? "Group" : contact.phone}
                </p>
              )}
              {conversation.whatsapp_config?.label && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  via {conversation.whatsapp_config.label}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Manual refresh — forces a refetch of the messages + the
              conversation list (the parent bumps its resyncToken). Useful
              when realtime missed an event or the agent just wants to be
              sure nothing's stale. Only rendered when the parent wires
              up `onRefresh`. */}
          {onRefresh && (
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              aria-label="Refresh conversation"
              title="Refresh"
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60",
              )}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
              />
            </button>
          )}

          {/* Search this conversation */}
          <button
            type="button"
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            aria-label="Search chat"
            aria-pressed={searchOpen}
            title="Search"
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground",
              searchOpen ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Search className="h-3.5 w-3.5" />
          </button>

          {/* Status dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  currentStatus?.color ?? "text-muted-foreground"
                )}>
                <span className="hidden sm:inline">
                  {currentStatus?.label ?? "Status"}
                </span>
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover"
            >
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn("text-sm", opt.color)}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Assign dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                assignedAgentId ? "text-primary" : "text-muted-foreground"
              )}
            >
              <UserPlus className="h-3 w-3" />
              <span className="hidden sm:inline">{assignLabel}</span>
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover"
            >
              {profiles.length === 0 ? (
                <DropdownMenuItem disabled className="text-sm text-muted-foreground">
                  No teammates available
                </DropdownMenuItem>
              ) : (
                profiles.map((p) => {
                  const isSelected = p.user_id === assignedAgentId;
                  const presence = getPresence(p.user_id);
                  return (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => handleAssignChange(p.user_id)}
                      className={cn(
                        "text-sm",
                        isSelected ? "text-primary" : "text-popover-foreground"
                      )}
                    >
                      <PresenceDot
                        status={presence}
                        label={presenceLabel(
                          presence,
                          getRow(p.user_id)?.last_seen_at ?? null,
                          now
                        )}
                        className="mr-2"
                      />
                      <span className="flex-1">
                        {p.full_name}
                        {p.user_id === user?.id ? " (me)" : ""}
                      </span>
                      {isSelected && <Check className="ml-2 h-3 w-3" />}
                    </DropdownMenuItem>
                  );
                })
              )}
              {assignedAgentId && (
                <>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem
                    onClick={() => handleAssignChange(null)}
                    className="text-sm text-muted-foreground"
                  >
                    Unassign
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* More actions */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              aria-label="More actions"
            >
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-border bg-popover">
              <DropdownMenuItem onClick={createTask} className="text-sm">
                <ListTodo className="mr-2 h-4 w-4" />
                Create task
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {conversation?.pinned_at ? (
                <DropdownMenuItem onClick={() => conversationAction("unpin")} className="text-sm">
                  <PinOff className="mr-2 h-4 w-4" />
                  Unpin chat
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => conversationAction("pin")} className="text-sm">
                  <Pin className="mr-2 h-4 w-4" />
                  Pin chat
                </DropdownMenuItem>
              )}
              {conversation?.muted_until ? (
                <DropdownMenuItem onClick={() => conversationAction("unmute")} className="text-sm">
                  <Bell className="mr-2 h-4 w-4" />
                  Unmute chat
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => conversationAction("mute")} className="text-sm">
                  <BellOff className="mr-2 h-4 w-4" />
                  Mute chat
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {conversation?.archived_at ? (
                <DropdownMenuItem onClick={() => conversationAction("unarchive")} className="text-sm">
                  <Archive className="mr-2 h-4 w-4" />
                  Unarchive conversation
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => conversationAction("archive")} className="text-sm">
                  <Archive className="mr-2 h-4 w-4" />
                  Archive conversation
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => conversationAction("mark_unread")} className="text-sm">
                <MailOpen className="mr-2 h-4 w-4" />
                Mark as unread
              </DropdownMenuItem>
              {conversation?.hidden_at ? (
                <DropdownMenuItem onClick={() => conversationAction("unhide")} className="text-sm">
                  <Eye className="mr-2 h-4 w-4" />
                  Unhide chat
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => conversationAction("hide")} className="text-sm">
                  <EyeOff className="mr-2 h-4 w-4" />
                  Hide chat
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={handleClearChat} className="text-sm">
                <Eraser className="mr-2 h-4 w-4" />
                Clear chat on phone
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleBlockContact} className="text-sm text-red-500">
                <Ban className="mr-2 h-4 w-4" />
                Block contact
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDeleteChat} className="text-sm text-red-500">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete chat
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Contact-panel toggle — placed last in the row (after the ⋮
              menu). Desktop only; the contact sidebar eats a chunk of
              horizontal width that crowds the thread on smaller laptops, so
              this lets agents reclaim it when they just want to read and
              reply. Hidden on mobile, where the sidebar never renders as a
              permanent panel anyway. Issue #258. */}
          {onToggleContactPanel && (
            <button
              type="button"
              onClick={onToggleContactPanel}
              aria-label={
                contactPanelOpen ? "Hide contact panel" : "Show contact panel"
              }
              aria-pressed={contactPanelOpen}
              title={contactPanelOpen ? "Hide contact" : "Show contact"}
              className={cn(
                "hidden h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground xl:inline-flex",
                contactPanelOpen ? "text-primary" : "text-muted-foreground",
              )}
            >
              {contactPanelOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </button>
          )}

          {/* Mobile/tablet (<xl): the static contact panel is hidden, so
              this opens it in a drawer instead. Issue #258. */}
          {onOpenContactSheet && (
            <button
              type="button"
              onClick={onOpenContactSheet}
              aria-label="Show contact panel"
              title="Contact"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground xl:hidden"
            >
              <PanelRightOpen className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* In-conversation search bar */}
      {searchOpen && (
        <div className="flex items-center gap-1 border-b border-border bg-secondary px-4 py-2">
          <Search className="mr-1 h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setMatchIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                gotoMatch(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                closeSearch();
              }
            }}
            placeholder="Search this chat"
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {searchQuery.trim() && (
            <span className="shrink-0 px-1 text-xs text-muted-foreground">
              {matchIds.length
                ? `${Math.min(matchIndex, matchIds.length - 1) + 1}/${matchIds.length}`
                : "0/0"}
            </span>
          )}
          <button
            type="button"
            onClick={() => gotoMatch(-1)}
            disabled={!matchIds.length}
            aria-label="Previous match"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => gotoMatch(1)}
            disabled={!matchIds.length}
            aria-label="Next match"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={closeSearch}
            aria-label="Close search"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Messages Area */}
      <div
        ref={scrollRef}
        onScroll={handleThreadScroll}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">No messages yet</p>
            <p className="text-xs text-muted-foreground">
              Send a template to start the conversation
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messageGroups.map((group) => (
              <div key={group.date}>
                {/* Date separator */}
                <div className="mb-4 flex items-center justify-center">
                  <span className="rounded-full bg-muted px-3 py-1 text-[10px] font-medium text-muted-foreground">
                    {formatDateSeparator(group.date)}
                  </span>
                </div>
                {/* Messages */}
                <div className="space-y-2">
                  {group.messages.map((msg) => {
                    const parent = msg.reply_to_message_id
                      ? messagesById.get(msg.reply_to_message_id)
                      : null;
                    const reply = parent
                      ? {
                          authorLabel: authorLabelFor(parent),
                          preview: buildReplyPreview(parent),
                        }
                      : null;
                    const msgReactions = reactionsByMessageId.get(msg.id);
                    // Toggle is computed at the call site — `msgReactions`
                    // and `user?.id` are already in scope, no extra hook.
                    const handlePillToggle = (emoji: string) => {
                      const own = msgReactions?.find(
                        (r) =>
                          r.actor_type === "agent" &&
                          r.actor_id === user?.id,
                      );
                      const next = own?.emoji === emoji ? "" : emoji;
                      void postReaction(msg.id, next);
                    };
                    return (
                      <div
                        key={msg.id}
                        id={`msg-${msg.id}`}
                        className={cn(
                          "rounded-lg transition-colors",
                          activeMatchId === msg.id && "bg-primary/10",
                        )}
                      >
                        <MessageActions
                          message={msg}
                          onReply={() => handleStartReply(msg)}
                          onReact={(emoji) => {
                            if (emoji) void postReaction(msg.id, emoji);
                          }}
                          onEdit={() => handleEditMessage(msg)}
                          onDelete={() => handleDeleteMessage(msg)}
                          onForward={() => setForwardMsgId(msg.id)}
                          onStar={() => handleToggleStar(msg)}
                          isStarred={!!msg.starred_at}
                          onPin={() => handleTogglePin(msg)}
                          isPinned={
                            !!(msg.pinned_until && new Date(msg.pinned_until) > new Date())
                          }
                        >
                          <MessageBubble
                            message={msg}
                            reply={reply}
                            reactions={msgReactions}
                            currentUserId={user?.id}
                            onToggleReaction={handlePillToggle}
                          />
                        </MessageActions>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <MessageComposer
        conversationId={conversation.id}
        onSend={handleSend}
        onSendMedia={handleSendMedia}
        onOpenTemplates={handleOpenTemplates}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
      />

      <TemplatePicker
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        onSelect={handleSendTemplate}
      />

      <ForwardDialog
        messageId={forwardMsgId}
        fromConversationId={conversation.id}
        onClose={() => setForwardMsgId(null)}
        onForwarded={onRefresh}
      />
    </div>
  );
}
