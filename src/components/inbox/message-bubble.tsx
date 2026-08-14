'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Message, MessageReaction } from '@/types';
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
  Ban,
  UserRound,
  BarChart3,
  PhoneCall,
  Star,
  CalendarClock,
  Pin,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import { ReplyQuote } from './reply-quote';
import { MessageReactions } from './message-reactions';
import { useMentions } from './mention-context';
import { splitMentionTokens } from '@/lib/whatsapp/mentions';

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
}

/**
 * Turn `@<token>` runs into clickable names.
 *
 * Applied only to the plain-text stretches left over after URL matching —
 * a link like `https://x.com/@1234567` contains something that looks
 * exactly like a mention, and splitting the raw string first would break
 * the URL in half.
 */
function MentionRuns({ text, keyBase }: { text: string; keyBase: number }) {
  const { labelFor, phoneFor, openProfile } = useMentions();
  const parts = splitMentionTokens(text);
  if (parts.length === 1 && parts[0].type === 'text') return <>{text}</>;

  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text') return part.value;
        const phone = phoneFor(part.token);
        // Not every mention can be resolved: WhatsApp only shares a
        // member's number once you've had some contact with them, so a
        // mention of a stranger in a large group has no phone and no
        // pushName. Render those as inert text — a link that opens
        // nothing is worse than no link.
        if (!phone) {
          return (
            <span key={`${keyBase}-m-${i}`} className="font-medium opacity-80">
              @{labelFor(part.token)}
            </span>
          );
        }
        return (
          <button
            key={`${keyBase}-m-${i}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openProfile({ phone, name: labelFor(part.token) });
            }}
            className="text-tick-read font-medium underline underline-offset-2 hover:opacity-80"
          >
            @{labelFor(part.token)}
          </button>
        );
      })}
    </>
  );
}

// Render message text with URLs turned into clickable hyperlinks
// (WhatsApp-style). Matches http(s):// and bare www. links, doesn't swallow
// trailing sentence punctuation, and opens in a new tab. Plain stretches
// then get @mention handling — see MentionRuns for why in that order.
function LinkText({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  // Local regex per call — a shared /g regex carries mutable lastIndex state.
  const urlRe = /((?:https?:\/\/|www\.)[^\s]+)/gi;
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  const pushPlain = (value: string) => {
    if (!value) return;
    nodes.push(<MentionRuns key={`t${key++}`} text={value} keyBase={key} />);
  };
  for (const m of text.matchAll(urlRe)) {
    const start = m.index ?? 0;
    if (start > last) pushPlain(text.slice(last, start));
    let url = m[0];
    const tail = url.match(/[.,!?;:)\]}'"]+$/)?.[0] ?? '';
    if (tail) url = url.slice(0, url.length - tail.length);
    const href = url.startsWith('http') ? url : `https://${url}`;
    nodes.push(
      <a
        key={key++}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-tick-read break-all underline underline-offset-2 hover:opacity-80"
      >
        {url}
      </a>
    );
    if (tail) nodes.push(tail);
    last = start + m[0].length;
  }
  if (last < text.length) pushPlain(text.slice(last));
  return <>{nodes}</>;
}

// Delivery ticks. These only render on outbound (agent) bubbles, which
// sit on the green `bubble-out` fill — so the un-read states use the
// bubble's own foreground at low opacity (like WhatsApp's faint grey
// ticks) and "read" flips to the signature blue double-tick.
function StatusIcon({ status }: { status: Message['status'] }) {
  switch (status) {
    case 'sending':
      return <Clock className="text-bubble-out-foreground/50 h-3 w-3" />;
    case 'sent':
      return <Check className="text-bubble-out-foreground/60 h-3.5 w-3.5" />;
    case 'delivered':
      return (
        <CheckCheck className="text-bubble-out-foreground/60 h-3.5 w-3.5" />
      );
    case 'read':
      return <CheckCheck className="text-tick-read h-3.5 w-3.5" />;
    case 'failed':
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

function MediaUnavailable({ label }: { label: string }) {
  return (
    <div className="bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-xs">
      <ImageOff className="text-muted-foreground h-4 w-4 shrink-0" />
      <span>{label} unavailable</span>
    </div>
  );
}

/**
 * Shown while the webhook is still pulling the file off WhatsApp. The
 * message bubble lands first (see the media backfill in the webhook
 * route); a Realtime UPDATE swaps this for the real media once it's up.
 */
function MediaPending({ label }: { label: string }) {
  return (
    <div className="bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-xs">
      <Loader2 className="text-muted-foreground h-4 w-4 shrink-0 animate-spin" />
      <span>Downloading {label.toLowerCase()}…</span>
    </div>
  );
}

/**
 * Which placeholder stands in for absent media. Rows written before
 * media_status existed have it NULL, and for those a missing URL still
 * means "unavailable" — so only an explicit 'pending' shows the spinner.
 */
function MediaFallback({
  message,
  label,
}: {
  message: Message;
  label: string;
}) {
  return message.media_status === 'pending' ? (
    <MediaPending label={label} />
  ) : (
    <MediaUnavailable label={label} />
  );
}

function MediaImage({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadImage = useCallback(async () => {
    if (!url) return;

    // Proxy URLs need auth fetch to create blob URL
    if (url.startsWith('/api/whatsapp/media/')) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load media');
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setSrc(blobUrl);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    loadImage();
    return () => {
      if (src?.startsWith('blob:')) {
        URL.revokeObjectURL(src);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadImage]);

  if (error) {
    return (
      <div className="bg-muted flex h-40 w-60 items-center justify-center rounded-lg">
        <ImageOff className="text-muted-foreground h-8 w-8" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-muted flex h-40 w-60 items-center justify-center rounded-lg">
        <div className="border-primary h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  return (
    <img
      src={src ?? ''}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="max-h-64 max-w-60 rounded-lg object-cover"
      onError={() => setError(true)}
    />
  );
}

function MessageContent({ message }: { message: Message }) {
  // Deleted-for-everyone (unsend) — show the WhatsApp-style placeholder
  // regardless of the original content type.
  if (message.deleted_at) {
    return (
      <p className="text-muted-foreground flex items-center gap-1 text-sm italic">
        <Ban className="h-3.5 w-3.5" />
        This message was deleted
      </p>
    );
  }

  switch (message.content_type) {
    case 'text':
      return (
        <p className="text-sm break-words whitespace-pre-wrap">
          <LinkText text={message.content_text} />
        </p>
      );

    case 'image':
      return (
        <div>
          {message.media_url ? (
            <MediaImage url={message.media_url} alt="Shared image" />
          ) : (
            <MediaFallback message={message} label="Image" />
          )}
          {message.content_text && (
            <p className="mt-1 text-sm break-words whitespace-pre-wrap">
              <LinkText text={message.content_text} />
            </p>
          )}
        </div>
      );

    case 'video':
      return (
        <div>
          {message.media_url ? (
            <video
              src={message.media_url}
              controls
              className="max-h-64 max-w-60 rounded-lg"
            />
          ) : (
            <MediaFallback message={message} label="Video" />
          )}
          {message.content_text && (
            <p className="mt-1 text-sm break-words whitespace-pre-wrap">
              <LinkText text={message.content_text} />
            </p>
          )}
        </div>
      );

    case 'audio':
      return (
        <div>
          {message.media_url ? (
            <audio src={message.media_url} controls className="max-w-60" />
          ) : (
            <MediaFallback message={message} label="Audio" />
          )}
        </div>
      );

    case 'document':
      if (!message.media_url) {
        return (
          <MediaFallback
            message={message}
            label={message.content_text || 'Document'}
          />
        );
      }
      return (
        <a
          href={message.media_url}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-muted/50 hover:bg-muted flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
        >
          <FileText className="text-muted-foreground h-5 w-5 shrink-0" />
          <span className="truncate">{message.content_text || 'Document'}</span>
        </a>
      );

    case 'template':
      return (
        <div>
          <span className="bg-primary/20 text-primary mb-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium">
            <LayoutTemplate className="h-3 w-3" />
            Template
          </span>
          {message.content_text && (
            <p className="mt-1 text-sm break-words whitespace-pre-wrap">
              <LinkText text={message.content_text} />
            </p>
          )}
        </div>
      );

    case 'location':
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="text-muted-foreground h-4 w-4 shrink-0" />
          <span>{message.content_text || 'Location shared'}</span>
        </div>
      );

    case 'contact':
      return (
        <div className="flex items-center gap-2 text-sm">
          <UserRound className="text-muted-foreground h-4 w-4 shrink-0" />
          <span>{message.content_text || 'Contact card'}</span>
        </div>
      );

    case 'poll':
      return (
        <div className="flex items-center gap-2 text-sm">
          <BarChart3 className="text-muted-foreground h-4 w-4 shrink-0" />
          <span>{message.content_text || 'Poll'}</span>
        </div>
      );

    case 'call':
      return (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <PhoneCall className="h-4 w-4 shrink-0" />
          <span>{message.content_text || 'Call'}</span>
        </div>
      );

    case 'event': {
      // content_text is a summary: first line = name, rest = 🗓 when /
      // 📍 where / description (see formatEventSummary).
      const [title, ...detail] = (message.content_text || 'Event').split('\n');
      return (
        <div className="border-border/60 bg-background/40 flex items-start gap-2 rounded-lg border p-2 text-sm">
          <CalendarClock className="text-primary mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium break-words">{title}</p>
            {detail.length > 0 && (
              <p className="text-muted-foreground mt-0.5 text-xs break-words whitespace-pre-wrap">
                {detail.join('\n')}
              </p>
            )}
          </div>
        </div>
      );
    }

    case 'interactive': {
      // Customer tapped a reply button or list row on a message the bot
      // sent. We show the tapped option's title (already in content_text,
      // set by parseMessageContent in the webhook) with a small affordance
      // so agents reading the inbox can tell at a glance that this is a
      // tap rather than the customer typing the same words.
      return (
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground inline-flex items-center gap-1 text-[10px] font-medium tracking-wide uppercase">
            <CornerDownLeft className="h-3 w-3" />
            Button reply
          </span>
          <p className="text-sm break-words whitespace-pre-wrap">
            <LinkText text={message.content_text || '[Interactive reply]'} />
          </p>
        </div>
      );
    }

    default:
      return (
        <p className="text-sm break-words whitespace-pre-wrap">
          <LinkText
            text={message.content_text || '[Unsupported message type]'}
          />
        </p>
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
}: MessageBubbleProps) {
  const isAgent =
    message.sender_type === 'agent' || message.sender_type === 'bot';
  const time = format(new Date(message.created_at), 'HH:mm');
  const { openProfile } = useMentions();

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div className={cn('flex flex-col', isAgent ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          // WhatsApp bubble: ~7.5px radius, a squared top corner on the
          // sender side, a small tail (the ::after triangle) at that
          // corner, and a soft lift shadow.
          'relative rounded-lg px-2.5 py-1.5 shadow-sm',
          "after:absolute after:top-0 after:h-0 after:w-0 after:border-solid after:content-['']",
          isAgent
            ? [
                'bg-bubble-out text-bubble-out-foreground rounded-tr-none',
                // right-pointing tail in the bubble colour
                'after:border-t-bubble-out after:right-[-8px] after:border-t-[8px] after:border-r-[8px] after:border-r-transparent',
              ]
            : [
                'bg-bubble-in text-bubble-in-foreground rounded-tl-none',
                // left-pointing tail in the bubble colour
                'after:border-t-bubble-in after:left-[-8px] after:border-t-[8px] after:border-l-[8px] after:border-l-transparent',
              ]
        )}
      >
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onPrimary={isAgent}
          />
        )}
        {!isAgent && message.author_name && (
          <div className="text-primary mb-0.5 text-xs font-semibold">
            {message.author_phone ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openProfile({
                    phone: message.author_phone ?? null,
                    name: message.author_name,
                  });
                }}
                className="underline-offset-2 hover:underline"
              >
                {message.author_name}
              </button>
            ) : (
              message.author_name
            )}
          </div>
        )}
        <MessageContent message={message} />
        <div
          className={cn(
            'mt-1 flex items-center gap-1',
            isAgent ? 'justify-end' : 'justify-start'
          )}
        >
          {message.starred_at && (
            <Star
              className={cn(
                'h-2.5 w-2.5 fill-current',
                isAgent ? 'text-bubble-out-foreground/70' : 'text-amber-400'
              )}
              aria-label="Starred"
            />
          )}
          {message.pinned_until &&
            new Date(message.pinned_until) > new Date() && (
              <Pin
                className={cn(
                  'h-2.5 w-2.5 fill-current',
                  isAgent ? 'text-bubble-out-foreground/70' : 'text-primary'
                )}
                aria-label="Pinned"
              />
            )}
          <span
            className={cn(
              'text-[10px]',
              // Outbound bubbles sit on the green `bubble-out` fill, so
              // the timestamp reads against that at low opacity (like
              // WhatsApp's faint meta text). Inbound uses muted.
              isAgent
                ? 'text-bubble-out-foreground/60'
                : 'text-muted-foreground'
            )}
          >
            {message.edited_at && !message.deleted_at ? 'edited · ' : ''}
            {time}
          </span>
          {isAgent && !message.deleted_at && (
            <StatusIcon status={message.status} />
          )}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
