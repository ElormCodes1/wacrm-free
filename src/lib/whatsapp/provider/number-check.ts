/**
 * "Is this number on WhatsApp?" checks, backed by Evolution's
 * `/chat/whatsappNumbers` endpoint (Baileys onWhatsApp).
 *
 * Used to reject sends to numbers that aren't registered on WhatsApp
 * before we waste a send attempt. Results are cached in-process with a
 * TTL so an active conversation doesn't re-check the same number on every
 * message. (A transient conversation exists per server instance; that's
 * fine — the check is an optimisation + a guard, not a source of truth.)
 *
 * Fail-open: if the check itself errors (network / instance down), we
 * return `null` ("unknown") and callers proceed with the send rather than
 * blocking a legitimate message on an infrastructure hiccup.
 */

import { checkWhatsappNumbers } from './evolution'

const TTL_MS = 6 * 60 * 60 * 1000 // 6h
const cache = new Map<string, { exists: boolean; ts: number }>()

/**
 * @returns true (on WhatsApp), false (definitely not), or null (unknown —
 * the check couldn't be completed; caller should not block on this).
 */
export async function isOnWhatsApp(
  instanceName: string,
  phone: string,
): Promise<boolean | null> {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return false
  const key = `${instanceName}:${digits}`

  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.exists

  try {
    const results = await checkWhatsappNumbers({ instanceName, numbers: [digits] })
    // Evolution echoes back the number it resolved; match loosely by suffix
    // since it may return the JID's number form.
    const match =
      results.find((r) => r.number.replace(/\D/g, '').endsWith(digits) || digits.endsWith(r.number.replace(/\D/g, ''))) ??
      results[0]
    const exists = match?.exists ?? false
    cache.set(key, { exists, ts: Date.now() })
    return exists
  } catch (err) {
    console.warn(
      '[number-check] isOnWhatsApp failed (allowing send):',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

/**
 * Batch variant for broadcasts — one API call for many numbers. Returns a
 * map of digits → exists. Numbers whose status can't be determined are
 * omitted from the map (callers treat "absent" as "unknown → allow").
 */
export async function whichAreOnWhatsApp(
  instanceName: string,
  phones: string[],
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>()
  const digitsList = phones.map((p) => p.replace(/\D/g, '')).filter(Boolean)
  if (digitsList.length === 0) return result

  // Serve from cache where possible; only ask Evolution for the rest.
  const toQuery: string[] = []
  for (const d of digitsList) {
    const hit = cache.get(`${instanceName}:${d}`)
    if (hit && Date.now() - hit.ts < TTL_MS) result.set(d, hit.exists)
    else toQuery.push(d)
  }

  if (toQuery.length > 0) {
    try {
      const rows = await checkWhatsappNumbers({ instanceName, numbers: toQuery })
      for (const r of rows) {
        const d = r.number.replace(/\D/g, '')
        // Map back to the queried form when Evolution normalised it.
        const original = toQuery.find((q) => q.endsWith(d) || d.endsWith(q)) ?? d
        result.set(original, r.exists)
        cache.set(`${instanceName}:${original}`, { exists: r.exists, ts: Date.now() })
      }
    } catch (err) {
      console.warn(
        '[number-check] whichAreOnWhatsApp failed (allowing all):',
        err instanceof Error ? err.message : err,
      )
      // leave `toQuery` numbers absent → treated as unknown/allow
    }
  }

  return result
}
