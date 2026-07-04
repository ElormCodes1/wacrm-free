import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { instanceForConversation } from '@/lib/whatsapp/resolve-send-target'
import {
  deleteMessageForEveryone,
  updateMessageText,
} from '@/lib/whatsapp/provider/evolution'

/**
 * Per-message lifecycle for OUTBOUND (agent/bot) messages.
 *
 *   DELETE /api/whatsapp/message/{id}          — unsend (delete for everyone)
 *   PATCH  /api/whatsapp/message/{id} { text } — edit the text
 *
 * `{id}` is our internal messages.id (UUID). Only messages we sent
 * (sender_type agent|bot) with a WhatsApp message_id can be modified.
 */

async function resolveContext(id: string) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'Unauthorized', status: 401 as const }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) return { error: 'No account', status: 403 as const }

  // Message + its conversation/contact, account-scoped through the join.
  const { data: msg } = await supabase
    .from('messages')
    .select(
      'id, message_id, sender_type, content_type, conversation_id, conversations!inner(account_id, whatsapp_config_id, contact:contacts(phone))',
    )
    .eq('id', id)
    .maybeSingle()
  if (!msg) return { error: 'Message not found', status: 404 as const }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conv = (Array.isArray(msg.conversations) ? msg.conversations[0] : msg.conversations) as any
  if (!conv || conv.account_id !== accountId) {
    return { error: 'Message not found', status: 404 as const }
  }
  const contact = Array.isArray(conv.contact) ? conv.contact[0] : conv.contact
  const phone: string | undefined = contact?.phone
  if (!phone) return { error: 'Contact phone missing', status: 400 as const }

  if (msg.sender_type !== 'agent' && msg.sender_type !== 'bot') {
    return { error: 'You can only modify messages you sent.', status: 403 as const }
  }
  if (!msg.message_id) {
    return { error: 'This message was never delivered to WhatsApp.', status: 400 as const }
  }

  const instanceName = await instanceForConversation(
    supabase,
    accountId,
    (conv.whatsapp_config_id as string | null) ?? null,
  )
  if (!instanceName) {
    return { error: 'WhatsApp not connected.', status: 400 as const }
  }

  const toDigits = phone.replace(/\D/g, '')
  return {
    supabase,
    msg,
    instanceName,
    toDigits,
    remoteJid: `${toDigits}@s.whatsapp.net`,
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const ctx = await resolveContext(id)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  try {
    await deleteMessageForEveryone({
      instanceName: ctx.instanceName,
      remoteJid: ctx.remoteJid,
      fromMe: true,
      id: ctx.msg.message_id as string,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Delete failed'
    return NextResponse.json({ error: `WhatsApp delete failed: ${message}` }, { status: 502 })
  }

  await ctx.supabase
    .from('messages')
    .update({ deleted_at: new Date().toISOString(), content_text: null, media_url: null })
    .eq('id', id)

  return NextResponse.json({ success: true })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const { text } = (await request.json().catch(() => ({}))) as { text?: string }
  if (!text || !text.trim()) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }

  const ctx = await resolveContext(id)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  if (ctx.msg.content_type !== 'text') {
    return NextResponse.json(
      { error: 'Only text messages can be edited.' },
      { status: 400 },
    )
  }

  try {
    await updateMessageText({
      instanceName: ctx.instanceName,
      to: ctx.toDigits,
      messageId: ctx.msg.message_id as string,
      text: text.trim(),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Edit failed'
    return NextResponse.json(
      { error: `WhatsApp edit failed (messages can only be edited within ~15 min): ${message}` },
      { status: 502 },
    )
  }

  await ctx.supabase
    .from('messages')
    .update({ content_text: text.trim(), edited_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ success: true })
}
