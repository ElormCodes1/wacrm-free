import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendProduct } from '@/lib/whatsapp/provider/evolution'
import { resolveSendTarget } from '@/lib/whatsapp/resolve-send-target'
import { resolveStoreInstance } from '@/lib/whatsapp/store-instance'
import { findCatalogProduct, productLink } from '@/lib/whatsapp/store-product'
import { findOrCreateConversation } from '@/lib/whatsapp/find-or-create-conversation'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

// Cap per request so this can't be turned into an unbounded blast; the UI
// picks from the contact list, and a bigger reach belongs in Broadcasts.
const MAX_CONTACTS = 30

/**
 * POST /api/whatsapp/store/:id/send-contacts  { contact_ids: string[] }
 *
 * Share a catalog product as a native WhatsApp product-card message to a
 * set of contacts (not just an open conversation). For each contact we
 * find-or-create their conversation, send FROM the Business number, and
 * persist the product card in the thread so it shows in the inbox.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: productId } = await params
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

    const { contact_ids } = (await request.json().catch(() => ({}))) as {
      contact_ids?: string[]
    }
    if (!Array.isArray(contact_ids) || contact_ids.length === 0) {
      return NextResponse.json({ error: 'contact_ids is required' }, { status: 400 })
    }
    if (contact_ids.length > MAX_CONTACTS) {
      return NextResponse.json(
        { error: `Pick at most ${MAX_CONTACTS} contacts (use Broadcasts for more).` },
        { status: 400 },
      )
    }

    // The Business number owns the catalog and is the only one that can send
    // its products.
    const store = await resolveStoreInstance()
    if ('error' in store) return NextResponse.json({ error: store.error }, { status: store.status })
    if (!store.isBusiness) {
      return NextResponse.json({ error: 'No WhatsApp Business number is connected.' }, { status: 400 })
    }

    const product = await findCatalogProduct(store.instanceName, productId)
    if (!product || !product.imageUrl || !product.businessNumber) {
      return NextResponse.json({ error: 'Product not found in the catalog' }, { status: 404 })
    }

    // Only this account's contacts are addressable.
    const { data: validContacts } = await supabase
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .in('id', contact_ids)
    const validIds = new Set((validContacts ?? []).map((c) => c.id as string))

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

    let sent = 0
    const failed: { contact_id: string; error: string }[] = []

    // Sequential so we don't hammer the WhatsApp socket (same reasoning as
    // the broadcast sender).
    for (const contactId of contact_ids) {
      if (!validIds.has(contactId)) {
        failed.push({ contact_id: contactId, error: 'Not in this account' })
        continue
      }
      try {
        const conversationId = await findOrCreateConversation(
          supabase,
          accountId,
          user.id,
          contactId,
        )
        if (!conversationId) throw new Error('Could not open a conversation')

        const target = await resolveSendTarget(supabase, accountId, conversationId)
        if (!target) throw new Error('Could not resolve the contact number')

        const { messageId } = await sendProduct({
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

        await supabase.from('messages').insert({
          conversation_id: conversationId,
          sender_type: 'agent',
          content_type: 'image',
          content_text: caption,
          media_url: product.imageUrl,
          message_id: messageId,
          status: 'sent',
        })
        await supabase
          .from('conversations')
          .update({
            last_message_text: `🛍️ ${product.name}`,
            last_message_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', conversationId)

        sent++
      } catch (e) {
        failed.push({
          contact_id: contactId,
          error: e instanceof Error ? e.message : 'Send failed',
        })
      }
    }

    return NextResponse.json({ success: true, sent, failed })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('Error in store send-contacts:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
