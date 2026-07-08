import { NextResponse } from 'next/server'
import { updateProduct, deleteProduct, type ProductInput } from '@/lib/whatsapp/provider/evolution'
import { catalogWriteError } from '@/lib/whatsapp/store-errors'
import { resolveStoreInstance } from '@/lib/whatsapp/store-instance'

/** PATCH — update a product (resends the full product). */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const ctx = await resolveStoreInstance()
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const body = (await request.json().catch(() => ({}))) as Partial<ProductInput>
  if (!body.name?.trim() || !body.currency?.trim() || typeof body.price !== 'number') {
    return NextResponse.json({ error: 'Name, price and currency are required' }, { status: 400 })
  }
  try {
    const product = await updateProduct({
      instanceName: ctx.instanceName,
      productId: id,
      product: {
        name: body.name.trim(),
        price: body.price,
        currency: body.currency.trim(),
        description: body.description?.trim() || '',
        retailerId: body.retailerId,
        url: body.url,
        isHidden: body.isHidden,
        images: body.images ?? [],
      },
    })
    return NextResponse.json({ product })
  } catch (e) {
    const { error, status } = catalogWriteError(e)
    return NextResponse.json({ error }, { status })
  }
}

/** DELETE — remove a product from the catalog. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const ctx = await resolveStoreInstance()
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  try {
    await deleteProduct({ instanceName: ctx.instanceName, productIds: [id] })
    return NextResponse.json({ success: true })
  } catch (e) {
    const { error, status } = catalogWriteError(e)
    return NextResponse.json({ error }, { status })
  }
}
