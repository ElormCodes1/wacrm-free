import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { updateProduct, deleteProduct, type ProductInput } from '@/lib/whatsapp/provider/evolution'

async function resolveInstance() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return { error: 'Unauthorized', status: 401 as const }
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) return { error: 'No account', status: 403 as const }
  const { data: configs } = await supabase
    .from('whatsapp_config')
    .select('instance_name, connection_state')
    .eq('account_id', accountId)
    .not('instance_name', 'is', null)
    .order('created_at', { ascending: true })
  const config = configs?.find((c) => c.connection_state === 'open') ?? configs?.[0]
  if (!config?.instance_name) return { error: 'WhatsApp is not connected.', status: 400 as const }
  return { instanceName: config.instance_name as string }
}

/** PATCH — update a product (resends the full product). */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const ctx = await resolveInstance()
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
    const m = e instanceof Error ? e.message : 'Failed to update product'
    return NextResponse.json({ error: m }, { status: 502 })
  }
}

/** DELETE — remove a product from the catalog. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const ctx = await resolveInstance()
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  try {
    await deleteProduct({ instanceName: ctx.instanceName, productIds: [id] })
    return NextResponse.json({ success: true })
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Failed to delete product'
    return NextResponse.json({ error: m }, { status: 502 })
  }
}
