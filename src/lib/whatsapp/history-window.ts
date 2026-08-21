/**
 * How much history a newly linked number brings with it.
 *
 * A link should start clean. The CRM picks up from the moment the number
 * was connected and carries on from there — no months of old chat, no
 * rolling window of yesterday, nothing the business did not do here.
 *
 * The cutoff is therefore WHEN THE NUMBER WAS LINKED, not an age. That
 * distinction is the whole design, because the backlog event carries two
 * quite different things:
 *
 *   old history      — everything from before the link. Not wanted, and
 *                      it arrived by the hundred: one number pulled 653
 *                      messages over three months.
 *
 *   reconnect backlog— messages sent WHILE THE SOCKET WAS DOWN. These
 *                      arrive under the same event and are real, missed
 *                      conversation. Dropping them is silent message
 *                      loss, and it is exactly what a blanket "no
 *                      history" rule would do.
 *
 * Anchored at the link, both fall out correctly: everything before it is
 * old history and goes; everything after it is a message this account
 * genuinely missed and stays, however late it arrives.
 *
 * Never applies to live messages, and never to reconcile's replays, which
 * recover messages that are old on purpose.
 */

/**
 * Hours of history to accept from BEFORE the link. Zero by default: a new
 * number starts empty and fills only as messages arrive.
 *
 * Exists for self-hosters who would rather have some run-up, and as the
 * escape hatch if a tenant asks for it. It shifts the cutoff earlier; it
 * never overrides it.
 */
export const DEFAULT_HISTORY_HOURS = 0

export function historyHoursFromEnv(
  raw: string | undefined = process.env.WHATSAPP_HISTORY_HOURS,
): number {
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_HISTORY_HOURS
}

/**
 * Should this backlog message be stored?
 *
 * @param messageTimestampSeconds WhatsApp's send time, in seconds.
 * @param linkedAtMs  When the number was first linked, in ms. Null when
 *   unknown — see below.
 * @param graceHours  Hours before the link to also accept.
 *
 * A message whose timestamp is missing or unusable is KEPT. This exists
 * to avoid hoarding old chat, and discarding a real message over a
 * malformed field costs far more than storing one extra.
 *
 * An unknown link time is also KEPT, for the same reason: it means we
 * could not read the number's row, which says nothing about the message.
 * Erring towards storage is recoverable — a stray old message in an inbox
 * is untidy. The other way is not.
 */
export function withinHistoryWindow(
  messageTimestampSeconds: unknown,
  linkedAtMs: number | null,
  graceHours: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _now: number = Date.now(),
): boolean {
  const ts = Number(messageTimestampSeconds)
  if (!Number.isFinite(ts) || ts <= 0) return true
  if (linkedAtMs === null) return true

  const cutoff = linkedAtMs - graceHours * 60 * 60 * 1000
  return ts * 1000 >= cutoff
}
