import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendProduct } from '@/lib/whatsapp/provider/evolution'
import { resolveSendTarget } from '@/lib/whatsapp/resolve-send-target'
import { resolveStoreInstance } from '@/lib/whatsapp/store-instance'
import { findCatalogProduct, productLink } from '@/lib/whatsapp/store-product'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * POST /api/whatsapp/send-product  { conversation_id, product_id }
 *
 * Share a catalog product as a native WhatsApp product-card message into a
 * conversation. Sent FROM the Business number (which owns the catalog) to
 * the conversation's contact; persisted in the conversation as an image
 * with the product details + link so it shows in the thread.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const limit = checkRateLimit(`send:${user.id}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) return NextResponse.json({ error: 'No account' }, { status: 403 })

    const { conversation_id, product_id } = (await request.json().catch(() => ({}))) as {
      conversation_id?: string
      product_id?: string
    }
    if (!conversation_id || !product_id) {
      return NextResponse.json({ error: 'conversation_id and product_id are required' }, { status: 400 })
    }

    // The Business number owns the catalog and is the only one that can send
    // its products.
    const store = await resolveStoreInstance()
    if ('error' in store) return NextResponse.json({ error: store.error }, { status: store.status })
    if (!store.isBusiness) {
      return NextResponse.json({ error: 'No WhatsApp Business number is connected.' }, { status: 400 })
    }

    const product = await findCatalogProduct(store.instanceName, product_id)
    if (!product || !product.imageUrl || !product.businessNumber) {
      return NextResponse.json({ error: 'Product not found in the catalog' }, { status: 404 })
    }

    // The recipient is the conversation's contact.
    const target = await resolveSendTarget(supabase, accountId, conversation_id)
    if (!target) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 400 })
    }

    let messageId: string
    try {
      const r = await sendProduct({
        instanceName: store.instanceName,
        to: target.toDigits,
        productId: product.id,
        title: product.name,
        description: product.description,
        currency: product.currency ?? 'USD',
        price: product.price ?? 0,
        image: product.imageUrl,
        businessOwnerJid: `${product.businessNumber}@s.whatsapp.net`,
      })
      messageId = r.messageId
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Send failed'
      return NextResponse.json({ error: `Couldn't send product: ${message}` }, { status: 502 })
    }

    // Persist in the conversation as an image with the product details + link.
    const link = productLink(product)
    const caption = [
      product.name,
      typeof product.price === 'number'
        ? `${product.currency ? `${product.currency} ` : ''}${product.price.toLocaleString()}`
        : '',
      link ? `🛒 ${link}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    const { data: row, error: msgErr } = await supabase
      .from('messages')
      .insert({
        conversation_id,
        sender_type: 'agent',
        content_type: 'image',
        content_text: caption,
        media_url: product.imageUrl,
        message_id: messageId,
        status: 'sent',
      })
      .select('id')
      .single()
    if (msgErr) {
      return NextResponse.json(
        { error: `Sent to WhatsApp but failed to save: ${msgErr.message}` },
        { status: 500 },
      )
    }

    await supabase
      .from('conversations')
      .update({
        last_message_text: `🛍️ ${product.name}`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation_id)

    return NextResponse.json({ success: true, message_id: row.id })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('Error in send-product:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
