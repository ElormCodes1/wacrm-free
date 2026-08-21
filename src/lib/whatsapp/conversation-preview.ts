/**
 * Keeping a conversation's preview on the NEWEST message.
 *
 * Every preview write used to stamp `last_message_at = now()` — the
 * moment we happened to process the event, not the moment the message was
 * sent. For live traffic the two are seconds apart and nobody notices.
 * For anything replayed or delayed they are not, and the consequences are
 * the ones people actually report:
 *
 *   - a reconnect backlog message from hours ago arrives, stamps itself
 *     `now()`, and jumps to the TOP of the inbox carrying old text
 *   - the preview moves BACKWARDS to an older message, because the update
 *     is unconditional and the last writer wins regardless of age
 *
 * The fix is to use the message's own timestamp and to refuse to move the
 * preview backwards. A conversation list is ordered by when people spoke,
 * not by when our webhook got round to it.
 */

/**
 * Should a message with this timestamp become the conversation's preview?
 *
 * True when there is nothing to compare against — a conversation with no
 * preview should get one. Ties count as newer: two messages in the same
 * second are indistinguishable here, and preferring the later-processed
 * one matches what a person watching the thread just saw.
 *
 * Unparseable input is treated as "yes". A preview is cosmetic; refusing
 * to update one over a malformed date would leave a thread showing
 * something stale forever, which is the very complaint this addresses.
 */
export function shouldMovePreview(
  currentLastMessageAt: string | null | undefined,
  messageAt: string | null | undefined,
): boolean {
  if (!currentLastMessageAt) return true
  if (!messageAt) return true

  const current = Date.parse(currentLastMessageAt)
  const incoming = Date.parse(messageAt)
  if (!Number.isFinite(current) || !Number.isFinite(incoming)) return true

  return incoming >= current
}

/**
 * The preview text for a message, matching what the database function
 * writes so the two can never disagree.
 *
 * A media message carries no text, and a blank preview reads as a bug.
 * `[image]` is not elegant, but it is honest and it is what the server
 * stores — the client showing `''` while the database holds `[image]` is
 * how a preview appears to "go missing" until the page is reloaded.
 */
export function previewText(
  contentText: string | null | undefined,
  contentType: string | null | undefined,
): string {
  const text = (contentText ?? '').trim()
  if (text) return text
  return `[${contentType || 'message'}]`
}
