import { MessageCircle, MessageCircleOff } from 'lucide-react';

/**
 * Compact WhatsApp-presence indicator for a contact.
 *
 *   true  → green "on WhatsApp"
 *   false → muted "not on WhatsApp"
 *   null/undefined → nothing (unverified — we don't claim either way)
 */
export function WhatsAppBadge({
  status,
  showLabel = false,
}: {
  status?: boolean | null;
  showLabel?: boolean;
}) {
  if (status === true) {
    return (
      <span
        title="On WhatsApp"
        className="inline-flex items-center gap-1 text-emerald-500 text-xs"
      >
        <MessageCircle className="size-3.5" />
        {showLabel && <span>On WhatsApp</span>}
      </span>
    );
  }
  if (status === false) {
    return (
      <span
        title="Not on WhatsApp"
        className="inline-flex items-center gap-1 text-muted-foreground text-xs"
      >
        <MessageCircleOff className="size-3.5" />
        {showLabel && <span>Not on WhatsApp</span>}
      </span>
    );
  }
  return null;
}
