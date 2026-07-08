import { NextResponse } from 'next/server'
import {
  fetchCatalog,
  fetchCollections,
  createProduct,
  type ProductInput,
} from '@/lib/whatsapp/provider/evolution'
import { catalogWriteError } from '@/lib/whatsapp/store-errors'
import { resolveStoreInstance } from '@/lib/whatsapp/store-instance'

/** GET — the store's business status + catalog products + collections. */
export async function GET() {
  const ctx = await resolveStoreInstance()
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const isBusiness = ctx.isBusiness
  let catalog: unknown = null
  try {
    catalog = await fetchCatalog({ instanceName: ctx.instanceName })
  } catch {
    /* no catalog (getCatalog throws on an empty catalog) */
  }
  // Collections read separately — reliable even when the catalog is empty.
  let collections: unknown = null
  try {
    collections = await fetchCollections({ instanceName: ctx.instanceName })
  } catch {
    /* no collections */
  }
  return NextResponse.json({ isBusiness, catalog, collections })
}

/** POST — create a product. Requires a WhatsApp Business account. */
export async function POST(request: Request) {
  const ctx = await resolveStoreInstance()
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const body = (await request.json().catch(() => ({}))) as Partial<ProductInput>
  if (!body.name?.trim() || !body.currency?.trim() || typeof body.price !== 'number') {
    return NextResponse.json({ error: 'Name, price and currency are required' }, { status: 400 })
  }
  if (!body.images?.length) {
    return NextResponse.json({ error: 'At least one image is required' }, { status: 400 })
  }
  try {
    const product = await createProduct({
      instanceName: ctx.instanceName,
      product: {
        name: body.name.trim(),
        price: body.price,
        currency: body.currency.trim(),
        description: body.description?.trim() || '',
        retailerId: body.retailerId,
        url: body.url,
        isHidden: body.isHidden,
        images: body.images,
      },
    })
    return NextResponse.json({ product })
  } catch (e) {
    const { error, status } = catalogWriteError(e)
    return NextResponse.json({ error }, { status })
  }
}
