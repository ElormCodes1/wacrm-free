/**
 * Telling a real name from a placeholder.
 *
 * Contacts are created from inbound messages, and WhatsApp only supplies
 * a pushName when the sender has set one and the event carries it. When
 * it does not, the creation path stores the phone number in `name` — so
 * the column is never empty and "we know their name" cannot be
 * distinguished from "we wrote the digits down again".
 *
 * In production that is not a corner case, it is the norm: 349 contacts,
 * every one with a `name`, and 283 of those names are just digits. One
 * account had 234 of 236.
 *
 * Display already copes — contactDisplayName falls back when name equals
 * phone. The damage is upstream of display: any code that asks "does this
 * contact have a name yet?" gets a yes, so a real name arriving later is
 * declined as an overwrite. The placeholder is sticky, and it wins.
 *
 * Hence this: one definition of "not really a name", used wherever a
 * better one might be applied.
 */

/** Digits, spaces and phone punctuation — nothing a person is called. */
const DIGITS_ONLY = /^[\d\s+\-()./]+$/

/**
 * True when `name` carries no more information than the phone number.
 *
 * Covers three cases seen in the data: empty, exactly the phone, and a
 * differently-formatted rendering of the same digits (`+233 54 123 4567`
 * against `233541234567`), which compares unequal as strings while
 * telling the reader nothing new.
 */
export function isPlaceholderName(
  name: string | null | undefined,
  phone?: string | null,
): boolean {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return true
  if (phone && trimmed === phone.trim()) return true
  // A bare number is a placeholder whatever phone we compare it against —
  // nobody is called "233541234567".
  return DIGITS_ONLY.test(trimmed)
}

/**
 * Pick the better of a stored name and an incoming one.
 *
 * Returns null when nothing should change, so callers can skip the write
 * rather than issue a no-op update per message.
 *
 * A real stored name is never replaced: whatever is there was more likely
 * set deliberately by someone in the business than derived from whatever
 * the contact currently calls themselves on WhatsApp.
 */
export function betterName(
  stored: string | null | undefined,
  incoming: string | null | undefined,
  phone?: string | null,
): string | null {
  const candidate = (incoming ?? '').trim()
  if (!candidate || isPlaceholderName(candidate, phone)) return null
  if (!isPlaceholderName(stored, phone)) return null
  return candidate
}
