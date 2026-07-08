import { NextResponse } from 'next/server'
import { updateProduct } from '@/lib/whatsapp/provider/evolution'
import { resolveStoreInstance } from '@/lib/whatsapp/store-instance'
import { findCatalogProduct } from '@/lib/whatsapp/store-product'
import { catalogWriteError } from '@/lib/whatsapp/store-errors'

/**
 * POST /api/whatsapp/store/{id}/hidden  { hidden: boolean }
 *
 * Toggle a product's visibility. WhatsApp has no partial product update, so
 * we re-send the whole product with `isHidden` flipped — including its
 * current image (an empty image list fails), which we read fresh from the
 * catalog here.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const ctx = await resolveStoreInstance()
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const { hidden } = (await request.json().catch(() => ({}))) as { hidden?: boolean }
  if (typeof hidden !== 'boolean') {
    return NextResponse.json({ error: 'hidden (boolean) is required' }, { status: 400 })
  }

  const product = await findCatalogProduct(ctx.instanceName, id)
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  if (!product.imageUrl) {
    return NextResponse.json({ error: 'Product has no image to preserve' }, { status: 422 })
  }

  try {
    await updateProduct({
      instanceName: ctx.instanceName,
      productId: id,
      product: {
        name: product.name,
        price: product.price ?? 0,
        currency: product.currency ?? 'USD',
        description: product.description ?? '',
        isHidden: hidden,
        images: [product.imageUrl],
      },
    })
    return NextResponse.json({ success: true, hidden })
  } catch (e) {
    const { error, status } = catalogWriteError(e)
    return NextResponse.json({ error }, { status })
  }
}
