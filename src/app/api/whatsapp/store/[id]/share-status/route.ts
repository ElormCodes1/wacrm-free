import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendStatus } from '@/lib/whatsapp/provider/evolution'
import { resolveStoreInstance } from '@/lib/whatsapp/store-instance'
import { findCatalogProduct, productCaption } from '@/lib/whatsapp/store-product'

const STATUS_TTL_MS = 24 * 60 * 60 * 1000

/**
 * POST /api/whatsapp/store/{id}/share-status
 *
 * Post a catalog product to the Business number's WhatsApp Status — the
 * product image with a caption (name / price / description) — so contacts
 * see it in Stories. Records a "My status" row so it also shows on the
 * Status page.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const ctx = await resolveStoreInstance()
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const product = await findCatalogProduct(ctx.instanceName, id)
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  if (!product.imageUrl) {
    return NextResponse.json({ error: 'Product has no image to share' }, { status: 422 })
  }

  const caption = productCaption(product)

  let messageId = ''
  try {
    const res = await sendStatus({
      instanceName: ctx.instanceName,
      type: 'image',
      content: product.imageUrl,
      caption,
      allContacts: true,
    })
    messageId = res.messageId
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Share failed'
    return NextResponse.json({ error: `Couldn't post to status: ${message}` }, { status: 502 })
  }

  // Record "My status" immediately (webhook echo is deduped by the
  // UNIQUE(account_id, message_id) upsert).
  if (messageId) {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const now = new Date()
    await admin.from('status_updates').upsert(
      {
        account_id: ctx.accountId,
        whatsapp_config_id: ctx.configId,
        is_mine: true,
        content_type: 'image',
        content_text: caption,
        media_url: product.imageUrl,
        message_id: messageId,
        posted_at: now.toISOString(),
        expires_at: new Date(now.getTime() + STATUS_TTL_MS).toISOString(),
      },
      { onConflict: 'account_id,message_id', ignoreDuplicates: true },
    )
  }

  return NextResponse.json({ success: true })
}
