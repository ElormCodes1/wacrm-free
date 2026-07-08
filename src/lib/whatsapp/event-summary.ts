/**
 * Human-readable summary for a WhatsApp event message, stored in
 * `messages.content_text` and rendered as an event card in the thread.
 * Shared by the outbound send route and the inbound webhook so both
 * directions read the same. Kept plain-text (newline-separated) so it
 * also degrades gracefully anywhere the card isn't rendered.
 */
export interface EventSummaryInput {
  name: string
  description?: string | null
  /** Start time, unix seconds. */
  startTime: number
  /** Optional end time, unix seconds. */
  endTime?: number | null
  location?: { name?: string | null; address?: string | null } | null
}

function fmt(unixSeconds: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(unixSeconds * 1000))
}

export function formatEventSummary(e: EventSummaryInput): string {
  const lines: string[] = [e.name]
  const when = e.endTime
    ? `🗓 ${fmt(e.startTime)} – ${fmt(e.endTime)}`
    : `🗓 ${fmt(e.startTime)}`
  lines.push(when)
  const place = e.location?.name || e.location?.address
  if (place) lines.push(`📍 ${place}`)
  if (e.description) lines.push(e.description)
  return lines.join('\n')
}
