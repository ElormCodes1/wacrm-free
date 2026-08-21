/**
 * How much history a newly linked number brings with it.
 *
 * Linking a number triggers a one-off history sync, and it arrives deep.
 * A number linked today pulled 653 messages going back three months, of
 * which 469 — 72% — were older than a day: storage and inbox clutter
 * spent on conversations nobody is going to act on, repeated for every
 * number anyone ever links.
 *
 * History is therefore capped by AGE rather than by count. A count cap
 * ("keep the last 200") cuts arbitrarily through the middle of active
 * conversations depending on how chatty each happens to be, and means
 * something different for every account. An age cap means the same thing
 * to everyone: what was live around the time they linked.
 *
 * This applies ONLY to the gateway's backlog event. Live messages are
 * never filtered, and neither are reconcile's replays, which recover
 * messages that are old on purpose.
 */

/** Hours of history to keep. 0 keeps none; the default is one day. */
export const DEFAULT_HISTORY_HOURS = 24

/**
 * Read the configured window.
 *
 * 0 is a legitimate setting — "start empty and fill only as new messages
 * arrive" — so it must survive rather than being treated as unset and
 * replaced by the default. Anything unparseable falls back.
 */
export function historyHoursFromEnv(
  raw: string | undefined = process.env.WHATSAPP_HISTORY_HOURS,
): number {
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_HISTORY_HOURS
}

/**
 * Is this backlog message recent enough to keep?
 *
 * A message whose timestamp is missing or unusable is KEPT. This cap
 * exists to save disk, and discarding a real message over a malformed
 * field is a far worse outcome than storing one extra — silent message
 * loss is the failure mode this system has already paid for.
 */
export function withinHistoryWindow(
  messageTimestampSeconds: unknown,
  hours: number,
  now: number = Date.now(),
): boolean {
  if (hours === 0) return false
  const ts = Number(messageTimestampSeconds)
  if (!Number.isFinite(ts) || ts <= 0) return true
  return now - ts * 1000 <= hours * 60 * 60 * 1000
}
