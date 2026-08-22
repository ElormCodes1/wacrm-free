'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from '@/lib/inbox/conversations';
import type {
  Conversation,
  Message,
  Contact,
  ConversationStatus,
} from '@/types';
import { useAuth } from '@/hooks/use-auth';
import { useRealtime } from '@/hooks/use-realtime';
import { shouldMovePreview, previewText } from '@/lib/whatsapp/conversation-preview';
import { ConversationList } from '@/components/inbox/conversation-list';
import { MessageThread } from '@/components/inbox/message-thread';
import { ContactSidebar } from '@/components/inbox/contact-sidebar';
import { MentionProvider } from '@/components/inbox/mention-context';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';
import { WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { companyPath } from "@/lib/tenancy/routes";
import { useCompanySlug } from "@/components/tenancy/company-link";

// Remembers the agent's show/hide choice for the desktop contact panel
// across reloads and sessions (device-scoped, like the theme prefs).
const CONTACT_PANEL_STORAGE_KEY = 'wacrm:inbox:contact-panel-open';

export default function InboxPage() {
  // The tenant, for scoping the realtime subscription below. Null until
  // the profile resolves, which the hook reads as "not ready" and
  // subscribes to nothing rather than to every account's traffic.
  const { accountId } = useAuth();
  const router = useRouter();
  const companySlug = useCompanySlug();
  const searchParams = useSearchParams();
  /**
   * `?c=<id>` deep-link support. Used when landing here from the
   * dashboard's recent-conversations list so the right thread opens
   * automatically instead of showing the empty center panel.
   */
  const deepLinkConvId = searchParams.get('c');

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] =
    useState<Conversation | null>(null);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [whatsappConnected, setWhatsappConnected] = useState<boolean | null>(
    null
  );
  /**
   * Bumped whenever we want children (ConversationList, MessageThread)
   * to refetch from the DB — used as a safety net against missed
   * realtime events. Bumped on WS reconnect and on tab visibility →
   * visible. The initial mount fetches don't depend on this; they fire
   * once on conversationId-change as usual.
   */
  const [resyncToken, setResyncToken] = useState(0);

  /**
   * Whether the desktop contact sidebar (tags / deals / notes) is shown.
   * Defaults to `true` (the historical behaviour) and is restored from
   * localStorage after mount. We deliberately do NOT read localStorage in
   * the initializer: the server renders with `true`, so reading a stored
   * `false` synchronously would produce a hydration mismatch. The effect
   * below reconciles to the stored value right after mount instead.
   */
  const [contactPanelOpen, setContactPanelOpen] = useState(true);
  // Mobile/tablet (<xl): the static contact panel is hidden, so it opens
  // in a drawer instead. Separate from the desktop open/collapse state.
  const [mobileContactOpen, setMobileContactOpen] = useState(false);

  /**
   * A profile opened from inside the thread — an @mention or a group
   * member's name. Kept separate from `activeContact` so the conversation
   * underneath doesn't change: you're peeking at someone, not switching to
   * them. Cleared by the panel's back control, and whenever the
   * conversation changes.
   */
  const [peekContact, setPeekContact] = useState<Contact | null>(null);
  const [peekConversationId, setPeekConversationId] = useState<string | null>(
    null
  );
  const [peekLoading, setPeekLoading] = useState(false);

  /**
   * Live connection state per number, keyed by whatsapp_config id.
   *
   * A conversation belongs to one of the account's numbers; if that line
   * is down, messages to this chat silently never arrive. Knowing which
   * line a chat is on is only useful if we also say when it's offline —
   * that pairing is the whole point of the chat ↔ number map.
   */
  const [numberStates, setNumberStates] = useState<Record<string, string>>({});

  // ---- @mention resolution -------------------------------------------
  // Mentions arrive as `@<token>` in the text plus a per-message token →
  // phone map (webhook, migration 057). Resolving names once here — rather
  // than per bubble — means the same person mentioned ten times costs one
  // lookup, and it keeps MessageThread's JSX untouched.
  const mentionIndex = useMemo(() => {
    const index = new Map<string, string | null>();
    for (const m of messages) {
      for (const mention of m.mentions ?? []) {
        if (!index.has(mention.token)) index.set(mention.token, mention.phone);
      }
    }
    return index;
  }, [messages]);

  const [mentionNames, setMentionNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const phones = [
      ...new Set([...mentionIndex.values()].filter(Boolean)),
    ] as string[];
    if (!phones.length) {
      setMentionNames({});
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      // Matched on the last 8 digits, the same way contact dedupe does —
      // stored numbers vary by country prefix and punctuation.
      const suffixes = phones.map((p) => (p.length >= 8 ? p.slice(-8) : p));
      const { data } = await supabase
        .from("contacts")
        .select("name, phone")
        .or(suffixes.map((sfx) => `phone.like.%${sfx}`).join(","));
      if (cancelled || !data) return;
      const byPhone: Record<string, string> = {};
      for (const phone of phones) {
        const suffix = phone.length >= 8 ? phone.slice(-8) : phone;
        const hit = data.find((c) => (c.phone ?? "").endsWith(suffix));
        if (hit?.name) byPhone[phone] = hit.name;
      }
      setMentionNames(byPhone);
    })();
    return () => {
      cancelled = true;
    };
  }, [mentionIndex]);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONTACT_PANEL_STORAGE_KEY);
      if (stored !== null) setContactPanelOpen(stored === 'true');
    } catch {
      // localStorage can throw in private-browsing / sandboxed contexts.
    }
  }, []);

  const handleToggleContactPanel = useCallback(() => {
    setContactPanelOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CONTACT_PANEL_STORAGE_KEY, String(next));
      } catch {
        // Persistence is best-effort; ignore storage failures.
      }
      return next;
    });
  }, []);

  // Fire the deep-link auto-select exactly once per URL — subsequent
  // list refreshes (realtime, manual refetch) must not snap the user
  // back to the deep-linked conversation if they've already clicked
  // elsewhere.
  const autoSelectedForDeepLinkRef = useRef<string | null>(null);

  // Tracks conversations whose hydrate fetch is currently in flight. The
  // conv-INSERT and the first-message-INSERT events both call into
  // hydrateConversation; the dedupe here keeps it at one refetch per
  // new conversation even when both events arrive within milliseconds.
  const hydratingConvIdsRef = useRef<Set<string>>(new Set());

  /**
   * Synchronous mirror of the conversation ids currently in `conversations`
   * state. Event handlers need to know "do we already have this conv?"
   * without waiting for a setState updater to run — updaters fire during
   * reconciliation, *after* the synchronous handler code returns, so a
   * `let foundInList = false; setState(p => { foundInList = ...; return ... })`
   * flag reads as `false` in the same tick (this exact bug shipped in #105
   * and caused #106: every incoming message and every status flip fired a
   * redundant DB hydrate, swamping the supabase client and starving the
   * realtime channel). The ref is kept in sync via the effect below.
   */
  const knownConvIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set<string>();
    for (const c of conversations) next.add(c.id);
    knownConvIdsRef.current = next;
  }, [conversations]);

  // Pull the conversation row with its `contact` joined and merge it
  // into state. Needed because Supabase Realtime payloads only carry the
  // row's own columns — a brand-new conversation arrives without a
  // contact, which surfaced as "Unknown" names, empty avatars, and
  // (when the conv-INSERT event was delayed past the message-INSERT)
  // conversations stuck on "No messages yet" until the user reloaded.
  // Also self-heals if a realtime event was missed: callers can invoke
  // this whenever they reference a conversation id they don't recognise.
  const hydrateConversation = useCallback(async (convId: string) => {
    if (hydratingConvIdsRef.current.has(convId)) return;
    hydratingConvIdsRef.current.add(convId);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('conversations')
        .select(CONVERSATION_SELECT)
        .eq('id', convId)
        .maybeSingle();
      if (error) {
        // Supabase errors have non-enumerable properties — log fields
        // explicitly so the console message isn't just `{}`.
        console.error('Failed to hydrate conversation:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        return;
      }
      if (!data) return;
      const fetched = normalizeConversation(data);
      setConversations((prev) => {
        const existing = prev.find((c) => c.id === fetched.id);
        if (existing) {
          // Already in state — keep its fields (a realtime UPDATE may
          // have landed while the fetch was in flight and patched
          // last_message_text / unread_count to fresher values than
          // the row we just read). Only backfill `contact`, which the
          // realtime payloads never carry.
          return prev.map((c) =>
            c.id === fetched.id
              ? { ...c, contact: c.contact ?? fetched.contact }
              : c
          );
        }
        return [fetched, ...prev];
      });
    } finally {
      hydratingConvIdsRef.current.delete(convId);
    }
  }, []);

  // Check WhatsApp connection status on mount
  useEffect(() => {
    const checkConnection = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) return;

      // whatsapp_config is one-row-per-account post-multi-user, so
      // the previous `.eq('user_id', user.id)` would miss the row
      // for any teammate who didn't personally save the config —
      // the "WhatsApp not connected" banner would show in the
      // shared inbox even though the admin had it configured.
      // Resolve account_id via the profile and query by that.
      const { data: profile } = await supabase
        .from('profiles')
        .select('account_id')
        .eq('user_id', user.id)
        .maybeSingle();
      const accountId = profile?.account_id as string | undefined;
      if (!accountId) {
        setWhatsappConnected(false);
        return;
      }

      // Probe-and-heal before reading state. The gateway's socket dies
      // quietly — twice in ninety minutes on this instance — and reports
      // "open" throughout, so the inbox goes silent with every indicator
      // green. Opening the inbox is the natural moment to notice and fix
      // that; the endpoint restarts anything it finds dead.
      try {
        await fetch('/api/whatsapp/health', { method: 'POST' });
      } catch {
        // Best effort: the read below still reports the truth.
      }

      // Read live state via the API rather than whatsapp_config.status.
      // The stored column is only written when a connection.update event
      // is processed, so a state change missed during an outage leaves it
      // stale indefinitely — it currently reports a disconnected line as
      // "open". The endpoint asks the gateway and writes the truth back.
      try {
        const res = await fetch('/api/whatsapp/config');
        const json = await res.json();
        const numbers = (json.numbers ?? []) as {
          id: string;
          label: string | null;
          connection_state: string;
        }[];
        setNumberStates(
          Object.fromEntries(numbers.map((n) => [n.id, n.connection_state]))
        );
        setWhatsappConnected(numbers.some((n) => n.connection_state === 'open'));
      } catch {
        // Fall back to the stored column rather than showing a scary
        // banner because one fetch failed.
        const { data } = await supabase
          .from('whatsapp_config')
          .select('status')
          .eq('account_id', accountId);
        setWhatsappConnected((data ?? []).some((r) => r.status === 'connected'));
      }
    };

    checkConnection();
  }, []);

  // Handle realtime message events
  const handleMessageEvent = useCallback(
    (event: { eventType: string; new: Message; old: Partial<Message> }) => {
      const newMsg = event.new;

      if (event.eventType === 'INSERT') {
        // Add to messages if it belongs to active conversation
        if (
          activeConversation &&
          newMsg.conversation_id === activeConversation.id
        ) {
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            // Replace optimistic message if it exists
            const withoutOptimistic = prev.filter(
              (m) => !m.id.startsWith('temp-')
            );
            return [...withoutOptimistic, newMsg];
          });
        }

        // Update conversation list preview. We need to know *synchronously*
        // whether the conv is already in state to decide between patching
        // the preview and triggering a hydrate — see the comment on
        // knownConvIdsRef for why a closure flag inside the updater would
        // always read false here.
        if (knownConvIdsRef.current.has(newMsg.conversation_id)) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === newMsg.conversation_id
                ? {
                    ...c,
                    // Two bugs lived on these lines. `content_text ?? ''`
                    // blanked the preview for media, which the server
                    // stores as '[image]' — so a preview looked like it
                    // had vanished until a reload. And the update was
                    // unconditional, so a replayed or late-arriving
                    // message dragged the preview BACKWARDS to older text.
                    ...(shouldMovePreview(c.last_message_at, newMsg.created_at)
                      ? {
                          last_message_text: previewText(
                            newMsg.content_text,
                            newMsg.content_type,
                          ),
                          last_message_at: newMsg.created_at,
                        }
                      : {}),
                    unread_count:
                      activeConversation?.id === newMsg.conversation_id
                        ? 0
                        : c.unread_count + 1,
                  }
                : c
            )
          );
        } else {
          // First time we're seeing this conv: the conv-INSERT event
          // hasn't landed yet, or was missed. Hydrate from the DB so
          // the row surfaces with its `contact` joined; the conv-UPDATE
          // event the webhook emits right after the message INSERT will
          // converge state when it arrives.
          hydrateConversation(newMsg.conversation_id);
        }
      }

      if (event.eventType === 'UPDATE') {
        // Update message status
        setMessages((prev) =>
          prev.map((m) => (m.id === newMsg.id ? { ...m, ...newMsg } : m))
        );
      }
    },
    [activeConversation, hydrateConversation]
  );

  // Handle realtime conversation events
  const handleConversationEvent = useCallback(
    (event: {
      eventType: string;
      new: Conversation;
      old: Partial<Conversation>;
    }) => {
      const conv = event.new;

      if (event.eventType === 'INSERT') {
        // Prepend immediately for snappy UX so the new conv shows in the
        // list right away, then hydrate to fill in the `contact` join
        // (realtime payloads never include joins). Skip both if we
        // already have the row — that shouldn't happen normally, but
        // out-of-order delivery would have us prepending a duplicate.
        if (!knownConvIdsRef.current.has(conv.id)) {
          setConversations((prev) => {
            if (prev.some((c) => c.id === conv.id)) return prev;
            return [conv, ...prev];
          });
          hydrateConversation(conv.id);
        }
      }

      if (event.eventType === 'UPDATE') {
        if (knownConvIdsRef.current.has(conv.id)) {
          // If this UPDATE is for the conv the user is currently viewing,
          // suppress the incoming unread_count — the user is reading it
          // RIGHT NOW, so any positive value would just flicker the badge
          // back on for the ~100ms it takes for the reset effect's server
          // UPDATE to round-trip. Non-active convs take the value as-is.
          const isActive = activeConversation?.id === conv.id;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conv.id
                ? {
                    ...c,
                    ...conv,
                    unread_count: isActive ? 0 : conv.unread_count,
                  }
                : c
            )
          );
        } else {
          // UPDATE arrived before the INSERT (or after a missed INSERT)
          // — fetch the row so it surfaces with its contact joined. The
          // patch contained in `conv` will already be reflected in what
          // the hydrate fetch returns.
          hydrateConversation(conv.id);
        }

        // Update active conversation if it changed
        if (activeConversation && conv.id === activeConversation.id) {
          setActiveConversation((prev) => (prev ? { ...prev, ...conv } : prev));
        }
      }
    },
    [activeConversation, hydrateConversation]
  );

  // Subscribe to realtime. The `isConnected` flag below feeds the
  // reconnect resync: realtime is best-effort and events sent while the
  // WS was disconnected (laptop sleep, network blip, background-tab
  // throttle) are simply lost. We need a way to catch up.
  const { isConnected } = useRealtime({
    channelName: 'inbox-realtime',
    onMessageEvent: handleMessageEvent,
    onConversationEvent: handleConversationEvent,
    enabled: true,
    // Scopes the subscription to this tenant. Until it resolves the hook
    // subscribes to nothing, rather than to everything.
    accountId,
  });

  /**
   * Bump `resyncToken` whenever the realtime channel transitions from
   * disconnected → connected *after* the initial connect. The initial
   * connect is covered by the children's on-mount fetches; only later
   * reconnects need a manual refetch to fill the gap.
   *
   * Tracked via a `was-connected` ref rather than a count so that React
   * strict-mode's dev-only effect double-fire doesn't read as a
   * reconnect.
   */
  const wasConnectedRef = useRef(false);
  const initialConnectDoneRef = useRef(false);
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) {
      // false → true transition
      if (initialConnectDoneRef.current) {
        setResyncToken((n) => n + 1);
      } else {
        initialConnectDoneRef.current = true;
      }
    }
    wasConnectedRef.current = isConnected;
  }, [isConnected]);

  /**
   * Refetch when the tab regains focus. Background tabs may have their
   * WS throttled by the browser even without a full disconnect, so a
   * visibilitychange → visible is a reliable signal that we may have
   * missed events. Cheap to fire; the children dedupe on their own.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setResyncToken((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  /**
   * Manual refresh trigger for the thread-header refresh button.
   * Bumps the same resyncToken the reconnect / visibility paths use,
   * so it goes through the existing dedupe & refetch plumbing — no
   * separate code path to keep in sync.
   */
  const handleManualRefresh = useCallback(() => {
    setResyncToken((n) => n + 1);
  }, []);

  const handleConversationsLoaded = useCallback(
    (loaded: Conversation[]) => {
      setConversations(loaded);
      // Resolve a pending deep-link here rather than in an effect — this
      // is an event handler, so the setState calls below are allowed by
      // react-hooks/set-state-in-effect. Runs once per ?c=<id> URL value
      // via the ref, so realtime refreshes of the list can't snap the
      // user back to the deep-linked thread after they've navigated.
      if (
        deepLinkConvId &&
        autoSelectedForDeepLinkRef.current !== deepLinkConvId &&
        loaded.length > 0
      ) {
        autoSelectedForDeepLinkRef.current = deepLinkConvId;
        // If the deep-linked conversation is already the active one
        // (e.g. because the user clicked it in the list and we
        // router.replace()'d the URL, which made the ConversationList
        // refetch and land us back here), do NOT re-apply it. Doing so
        // would setMessages([]) on a thread whose messages have
        // already been loaded by MessageThread — and because
        // conversationId didn't change, MessageThread wouldn't
        // refetch. The thread would read "No messages yet" until a
        // full page reload rehydrated state from scratch.
        if (activeConversation?.id === deepLinkConvId) return;
        const match = loaded.find((c) => c.id === deepLinkConvId);
        if (match) {
          setActiveConversation(match);
          setActiveContact(match.contact ?? null);
          setMessages([]);
          // Mirror the optimistic unread reset that handleSelectConversation
          // does — the user just deep-linked into this conv, treat that the
          // same as a click. Leaves activeConversation.unread_count alone so
          // the MessageThread reset effect still fires the server UPDATE.
          if (match.unread_count > 0) {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === match.id ? { ...c, unread_count: 0 } : c
              )
            );
          }
        }
      }
    },
    [deepLinkConvId, activeConversation?.id]
  );

  // When the Group Info panel learns a group's real subject / picture,
  // update the open contact (thread header + sidebar avatar) and its list
  // row so the raw-id "Group" fallback + missing icon fix live, no reload.
  const handleGroupResolved = useCallback(
    (update: { name?: string; avatarUrl?: string | null }) => {
      const patch: Partial<Contact> = {};
      if (update.name) patch.name = update.name;
      if (update.avatarUrl) patch.avatar_url = update.avatarUrl;
      if (patch.name === undefined && patch.avatar_url === undefined) return;
      setActiveContact((c) => (c && c.is_group ? { ...c, ...patch } : c));
      setConversations((prev) =>
        prev.map((cv) =>
          cv.id === activeConversation?.id && cv.contact?.is_group
            ? { ...cv, contact: { ...cv.contact, ...patch } }
            : cv
        )
      );
    },
    [activeConversation?.id]
  );

  /**
   * Resolve a phone to a contact and show it in the panel. The person
   * clicked is frequently not in the CRM yet — that's normal for a group
   * member — so the route creates them; the alternative is a dead link on
   * exactly the people you most need to look up.
   */
  const handleOpenProfile = useCallback(
    async (target: { phone: string | null; name?: string | null }) => {
      if (!target.phone) {
        toast.error('That mention has no phone number yet');
        return;
      }
      setPeekLoading(true);
      setMobileContactOpen(true);
      setContactPanelOpen(true);
      try {
        const res = await fetch('/api/contacts/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: target.phone,
            name: target.name ?? null,
          }),
        });
        const json = await res.json();
        if (!res.ok)
          throw new Error(json.error ?? 'Could not open that profile');
        setPeekContact(json.contact as Contact);
        setPeekConversationId(json.conversation_id as string);
      } catch (err) {
        setMobileContactOpen(false);
        toast.error(
          err instanceof Error ? err.message : 'Could not open that profile'
        );
      } finally {
        setPeekLoading(false);
      }
    },
    []
  );

  /** Leave the peeked profile and go back to the conversation's own contact. */
  const handleClosePeek = useCallback(() => {
    setPeekContact(null);
    setPeekConversationId(null);
  }, []);

  // Switching conversations ends any peek: the panel belongs to whatever
  // thread is open, and leaving a stale profile pinned there is how you
  // end up adding a note to the wrong person.
  useEffect(() => {
    setPeekContact(null);
    setPeekConversationId(null);
  }, [activeConversation?.id]);

  /**
   * The open conversation's line, when that line is not connected.
   *
   * Deliberately keyed off the conversation rather than "is any number
   * connected": with several numbers linked, the account looks healthy
   * while the specific line this chat lives on is down — which is exactly
   * the case that reads as "messages just stopped arriving".
   */
  const offlineNumber = useMemo(() => {
    const configId = activeConversation?.whatsapp_config_id;
    if (!configId) return null;
    const state = numberStates[configId];
    // undefined = not loaded yet; only warn on a state we actually know.
    if (!state || state === 'open') return null;
    return {
      label: activeConversation?.whatsapp_config?.label ?? 'This number',
      state,
    };
  }, [activeConversation, numberStates]);

  const mentionValue = useMemo(
    () => ({
      // Falls back through contact name → phone → raw token, so an
      // unresolved mention still reads as a person rather than vanishing.
      labelFor: (token: string) => {
        const phone = mentionIndex.get(token) ?? null;
        return (phone && mentionNames[phone]) || phone || token;
      },
      phoneFor: (token: string) => mentionIndex.get(token) ?? null,
      openProfile: handleOpenProfile,
    }),
    [mentionIndex, mentionNames, handleOpenProfile],
  );

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      // Re-clicking the already-active conversation would clear the
      // messages array, but the fetch effect in MessageThread only re-runs
      // when conversationId changes — so messages would stay empty until
      // the user navigated away and back. Bail out early instead.
      if (activeConversation?.id === conv.id) return;
      setActiveConversation(conv);
      setActiveContact(conv.contact ?? null);
      setMessages([]);
      // Optimistically clear the unread badge for this conv. The
      // server-side reset is fired by the unread-reset effect inside
      // MessageThread (which reads activeConversation.unread_count, not
      // the list copy — so we deliberately leave that intact below to
      // keep the effect firing), and the realtime UPDATE that comes
      // back will sync to 0 again as a no-op. Zeroing the list copy
      // here means the user sees the badge disappear the instant they
      // click instead of waiting for the round-trip — and it persists
      // even if the realtime UPDATE is dropped.
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conv.id && c.unread_count > 0 ? { ...c, unread_count: 0 } : c
        )
      );
      // Record the selection on the deep-link ref BEFORE we change the
      // URL. The router.replace below flips `deepLinkConvId`, which can
      // in turn cause ConversationList to refetch and eventually call
      // handleConversationsLoaded again. Without this line, the ref
      // still points at the previous value, the auto-select block
      // sees `ref !== deepLinkConvId`, fires a second time, and
      // clobbers the messages MessageThread just fetched.
      autoSelectedForDeepLinkRef.current = conv.id;
      // Reflect the selection in the URL so a refresh lands the user
      // back in the same thread, and so copy-paste links work. Use
      // replace() to avoid polluting browser history with every click.
      router.replace(companyPath(companySlug, "inbox", { query: { c: conv.id } }), { scroll: false });
    },
    [activeConversation?.id, router]
  );

  /**
   * Jump to the peeked person's own 1:1 thread.
   *
   * The conversation may not be in the loaded list — resolve just created
   * it, or it's far down — so hydrate first, then route through the same
   * `?c=<id>` deep link the rest of the app uses. Selecting it directly
   * would need the row, which is exactly what we might not have.
   */
  const handleMessagePeek = useCallback(() => {
    if (!peekConversationId) return;
    const convId = peekConversationId;
    setPeekContact(null);
    setPeekConversationId(null);
    setMobileContactOpen(false);

    const existing = conversations.find((c) => c.id === convId);
    if (existing) {
      handleSelectConversation(existing);
      return;
    }
    // Let the deep-link handler adopt it once the list has the row.
    autoSelectedForDeepLinkRef.current = null;
    void hydrateConversation(convId);
    router.replace(companyPath(companySlug, "inbox", { query: { c: convId } }), { scroll: false });
  }, [
    peekConversationId,
    conversations,
    handleSelectConversation,
    hydrateConversation,
    router,
  ]);

  // Mobile "back" — deselect the conversation so the list pane comes
  // back. Also clears the ?c= param so a refresh lands on the list
  // instead of re-opening the thread the user just backed out of.
  const handleCloseConversation = useCallback(() => {
    setActiveConversation(null);
    setActiveContact(null);
    setMessages([]);
    // Clearing the ref lets the deep-link auto-selector fire again if
    // the user later visits /inbox?c=<same-id> — desirable UX.
    autoSelectedForDeepLinkRef.current = null;
    router.replace(companyPath(companySlug, "inbox"), { scroll: false });
  }, [router]);

  const handleMessagesLoaded = useCallback((loaded: Message[]) => {
    setMessages(loaded);
  }, []);

  const handleNewMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  const handleUpdateMessage = useCallback(
    (id: string, updates: Partial<Message>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
      );
    },
    []
  );

  const handleStatusChange = useCallback(
    (conversationId: string, status: ConversationStatus) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, status } : c))
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) => (prev ? { ...prev, status } : prev));
      }
    },
    [activeConversation]
  );

  const handleAssignChange = useCallback(
    (conversationId: string, assignedAgentId: string | null) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, assigned_agent_id: assignedAgentId ?? undefined }
            : c
        )
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) =>
          prev
            ? { ...prev, assigned_agent_id: assignedAgentId ?? undefined }
            : prev
        );
      }
    },
    [activeConversation]
  );

  // On mobile (<lg) we show a SINGLE pane — either the list or the
  // thread — rather than cramming both side-by-side. Selecting a
  // conversation slides the thread in; the thread's back button pops
  // it back to the list. On lg+ both panes render side-by-side as
  // before, unchanged.
  const hasActiveConv = !!activeConversation;

  return (
    <div className="-m-4 flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden sm:-m-6">
      {/* WhatsApp connection banner — in the flex column, not absolute,
          so it pushes the panels down instead of overlapping them. */}
      {whatsappConnected === false && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2">
          <WifiOff className="h-4 w-4 text-amber-400" />
          <p className="text-xs text-amber-400">
            WhatsApp® is not connected. Go to Settings to connect your account.
          </p>
        </div>
      )}

      {/* Per-conversation line warning. The account-level banner above
          only fires when NO number is connected; this one catches the
          case that actually bites — one line down among several, so the
          chats on it go quiet with nothing to explain why. */}
      {offlineNumber && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2">
          <WifiOff className="h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-xs text-amber-400">
            This chat is on <span className="font-semibold">{offlineNumber.label}</span>, which
            is disconnected — new messages won&apos;t arrive and replies won&apos;t send.
            Reconnect it in Settings.
          </p>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: Conversation list.
            Hidden on mobile when a conversation is selected so the
            thread can occupy the full width. Always visible on lg+. */}
        <div
          className={cn(
            'flex h-full flex-1 lg:flex-none',
            hasActiveConv ? 'hidden lg:flex' : 'flex'
          )}
        >
          <ConversationList
            activeConversationId={activeConversation?.id ?? null}
            onSelect={handleSelectConversation}
            conversations={conversations}
            onConversationsLoaded={handleConversationsLoaded}
            resyncToken={resyncToken}
          />
        </div>

        {/* Center panel: Message thread.
            Hidden on mobile when no conversation is selected so the
            list can occupy the full width. Always visible on lg+
            (shows its own empty-state if no thread is picked yet).

            `min-w-0` is load-bearing: without it, a single wide piece
            of content inside the thread (long quote preview, very
            long URL in a message body) forces the flex child past
            its share and pushes the contact-sidebar panel off-screen
            on the right. Issue #165. */}
        <div
          className={cn(
            'flex h-full min-w-0 flex-1 lg:flex',
            hasActiveConv ? 'flex' : 'hidden lg:flex'
          )}
        >
          <MentionProvider value={mentionValue}>
            <MessageThread
              conversation={activeConversation}
              contact={activeContact}
              messages={messages}
              onMessagesLoaded={handleMessagesLoaded}
              onNewMessage={handleNewMessage}
              onUpdateMessage={handleUpdateMessage}
              onStatusChange={handleStatusChange}
              onAssignChange={handleAssignChange}
              onBack={handleCloseConversation}
              resyncToken={resyncToken}
              onRefresh={handleManualRefresh}
              contactPanelOpen={contactPanelOpen}
              onToggleContactPanel={handleToggleContactPanel}
              onOpenContactSheet={() => setMobileContactOpen(true)}
            />
          </MentionProvider>
        </div>

        {/* Right panel: Contact sidebar — desktop only, and only when the
            agent hasn't collapsed it via the thread-header toggle (#258).
            On mobile it's always hidden (the `lg:block` below), so the
            toggle — which is itself desktop-only — never affects it. */}
        {contactPanelOpen && (
          <div className="hidden xl:block">
            <ContactSidebar
              contact={peekContact ?? activeContact}
              onGroupResolved={handleGroupResolved}
              peeking={!!peekContact || peekLoading}
              onClosePeek={handleClosePeek}
              onMessage={peekConversationId ? handleMessagePeek : undefined}
              loading={peekLoading}
            />
          </div>
        )}
      </div>

      {/* Mobile/tablet contact panel drawer (<lg). Sized to the sidebar's
          own width so it fills the sheet exactly. Opened from the thread
          header's contact button. */}
      <Sheet open={mobileContactOpen} onOpenChange={setMobileContactOpen}>
        <SheetContent side="right" className="w-70 max-w-[88vw] p-0 xl:hidden">
          <SheetTitle className="sr-only">Contact details</SheetTitle>
          <ContactSidebar
            contact={peekContact ?? activeContact}
            onGroupResolved={handleGroupResolved}
            peeking={!!peekContact || peekLoading}
            onClosePeek={handleClosePeek}
            onMessage={peekConversationId ? handleMessagePeek : undefined}
            loading={peekLoading}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
