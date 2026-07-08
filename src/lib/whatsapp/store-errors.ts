/**
 * Map a WhatsApp catalog-write failure to an actionable message + status.
 *
 * WhatsApp gates programmatic catalog writes from Baileys:
 *  - `item-not-found` → the account's catalog isn't initialized yet (the
 *    business must add its first product in the WhatsApp Business app before
 *    it will accept programmatic writes).
 *  - `not-acceptable` → the number isn't a WhatsApp Business account.
 */
export function catalogWriteError(e: unknown): { error: string; status: number } {
  const m = e instanceof Error ? e.message : 'Failed'
  if (/item-not-found/i.test(m)) {
    return {
      error:
        "Your WhatsApp catalog isn't set up yet. Add your first product in the WhatsApp Business app (Settings → Business tools → Catalog); after that you can manage products here.",
      status: 409,
    }
  }
  if (/not-acceptable/i.test(m)) {
    return {
      error: 'This number is not a WhatsApp Business account, so it has no catalog.',
      status: 409,
    }
  }
  return { error: m, status: 502 }
}
