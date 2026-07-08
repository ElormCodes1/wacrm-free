import { fetchCatalog, jidToPhone } from '@/lib/whatsapp/provider/evolution'

export interface CatalogProduct {
  id: string
  name: string
  price?: number
  currency?: string
  description?: string
  /** Freshest product image URL (WhatsApp CDN). */
  imageUrl?: string
  /** The business number that owns the catalog (digits) — for the product link. */
  businessNumber?: string
}

/**
 * WhatsApp's public deep link for a catalog product — opens the product in
 * WhatsApp. Format: https://wa.me/p/<productId>/<businessPhoneNoPlus>.
 */
export function productLink(p: CatalogProduct): string | undefined {
  if (!p.id || !p.businessNumber) return undefined
  return `https://wa.me/p/${p.id}/${p.businessNumber}`
}

/**
 * Fetch a single product from the connected number's catalog by id, with a
 * fresh image URL. Used by the hide + share-to-status actions, which both
 * need to re-send / re-post the product's current image (the CDN URLs carry
 * short-lived tokens, so we always read a fresh one server-side).
 */
export async function findCatalogProduct(
  instanceName: string,
  productId: string,
): Promise<CatalogProduct | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const catalog = (await fetchCatalog({ instanceName })) as any
  const businessNumber = jidToPhone(catalog?.wuid) || undefined
  const list: unknown = catalog?.catalog ?? catalog?.products ?? []
  const arr = Array.isArray(list) ? list : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = arr.find((x: any) => (x?.id ?? x?.productId) === productId) as any
  if (!p) return null
  return {
    id: p.id ?? p.productId,
    name: p.name ?? 'Product',
    price: typeof p.price === 'number' ? p.price : undefined,
    currency: p.currency,
    description: p.description,
    imageUrl:
      p.imageUrls?.original ??
      p.imageUrls?.requested ??
      p.imageUrl ??
      p.images?.[0]?.url,
    businessNumber,
  }
}

/**
 * A caption for sharing a product (to a status, etc.). Ends with WhatsApp's
 * tappable product link so viewers can open it in the catalog.
 */
export function productCaption(p: CatalogProduct): string {
  const lines = [p.name]
  if (typeof p.price === 'number') {
    lines.push(`${p.currency ? `${p.currency} ` : ''}${p.price.toLocaleString()}`)
  }
  if (p.description) lines.push(p.description)
  const link = productLink(p)
  if (link) lines.push(`🛒 ${link}`)
  return lines.join('\n')
}
