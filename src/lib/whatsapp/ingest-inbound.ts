import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The storage half of inbound ingestion, in one round trip.
 *
 * Storing a message costs four separate calls to a REMOTE database —
 * find-or-create the contact, find-or-create the conversation, insert the
 * message alongside a prior-inbound check, bump the conversation's
 * counters — and each is real network latency. Measured cost was 1.2–4.2s
 * per message, against a concurrency budget every tenant shares. Fair
 * queueing decides who waits; only this makes the work cheaper.
 *
 * See migration 082. The function is storage ONLY: flows, automations,
 * avatar and profile enrichment, broadcast flagging and outbound webhooks
 * all stay in the caller, which is why it returns the facts those
 * decisions need rather than making them.
 */

export interface IngestResult {
  deduped: boolean
  contactId: string
  contactCreated: boolean
  /** The avatar as it was BEFORE this call — drives first-contact sync. */
  contactAvatarUrl: string | null
  conversationId: string
  conversationCreated: boolean
  /** Null for a reaction, which resolves a conversation but stores nothing. */
  messageRowId: string | null
  isFirstInbound: boolean
}

export interface IngestParams {
  accountId: string
  userId: string
  whatsappConfigId: string | null
  remoteJid: string | null
  phone: string
  contactName: string
  messageId: string
  contentType: string
  contentText: string | null
  mediaPending: boolean
  createdAt: string
  interactiveReplyId: string | null
  mentions: unknown
  replyToMetaId: string | null
  isHistory: boolean
  insertMessage: boolean
}

/**
 * Whether the database has the function yet.
 *
 * Deployment order is not guaranteed: this code can reach production
 * before the migration is applied, and on a self-hosted install it may
 * never be. One probe answers that for the life of the process — retrying
 * per message would add a failed round trip to the very path being
 * optimised, and emit one log line per message while doing it.
 *
 * Reset to null only by a restart, which is also when a newly applied
 * migration would be picked up.
 */
let available: boolean | null = null

/** Escape hatch: WHATSAPP_FAST_INGEST=0 forces the original path. */
function enabled(): boolean {
  return process.env.WHATSAPP_FAST_INGEST !== '0'
}

/** Test seam, and the way a deploy re-probes after a migration lands. */
export function resetIngestAvailability(): void {
  available = null
}

/**
 * Returns null when the caller should use the original path.
 *
 * Null is not an error — it is "not available here", and the caller has a
 * complete implementation to fall back on. That is deliberate: this
 * replaces the hottest path in the app, and a version that could only
 * fail loudly would turn a missing migration into lost messages.
 */
export async function ingestInbound(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  params: IngestParams,
): Promise<IngestResult | null> {
  if (!enabled() || available === false) return null

  try {
    const { data, error } = await supabase.rpc('whatsapp_ingest_inbound', {
      p_account_id: params.accountId,
      p_user_id: params.userId,
      p_whatsapp_config_id: params.whatsappConfigId,
      p_remote_jid: params.remoteJid,
      p_phone: params.phone,
      p_contact_name: params.contactName,
      p_message_id: params.messageId,
      p_content_type: params.contentType,
      p_content_text: params.contentText,
      p_media_pending: params.mediaPending,
      p_created_at: params.createdAt,
      p_interactive_reply_id: params.interactiveReplyId,
      p_mentions: params.mentions ?? null,
      p_reply_to_meta_id: params.replyToMetaId,
      p_is_history: params.isHistory,
      p_insert_message: params.insertMessage,
    })

    if (error) {
      // PGRST202 (no such function) / 42883 (undefined_function) mean the
      // migration has not been applied. That is a permanent condition for
      // this process, so stop asking. Anything else is treated as a
      // one-off: fall back for this message, try again on the next.
      const missing =
        error.code === 'PGRST202' ||
        error.code === '42883' ||
        /function .*whatsapp_ingest_inbound.* does not exist/i.test(error.message ?? '')
      if (missing) {
        available = false
        console.warn(
          '[webhook] whatsapp_ingest_inbound is not installed (migration 082); ' +
            'using the original ingestion path',
        )
      } else {
        console.error('[webhook] fast ingest failed, falling back:', error.message)
      }
      return null
    }

    const row = data as Record<string, unknown> | null
    if (!row) return null

    // The function reports its own refusals rather than throwing, so an
    // unresolved contact or conversation reaches here as data. Fall back
    // and let the original path — with its retry loops — have a go.
    if (typeof row.error === 'string') {
      console.error('[webhook] fast ingest could not resolve:', row.error)
      return null
    }

    available = true

    if (row.deduped === true) {
      return {
        deduped: true,
        contactId: '',
        contactCreated: false,
        contactAvatarUrl: null,
        conversationId: '',
        conversationCreated: false,
        messageRowId: null,
        isFirstInbound: false,
      }
    }

    return {
      deduped: false,
      contactId: String(row.contact_id),
      contactCreated: row.contact_created === true,
      contactAvatarUrl: (row.contact_avatar_url as string | null) ?? null,
      conversationId: String(row.conversation_id),
      conversationCreated: row.conversation_created === true,
      messageRowId: (row.message_row_id as string | null) ?? null,
      isFirstInbound: row.is_first_inbound === true,
    }
  } catch (err) {
    // A client that cannot even issue rpc() (the test harness, an older
    // supabase-js) must not take the webhook down with it.
    console.error(
      '[webhook] fast ingest unavailable, falling back:',
      err instanceof Error ? err.message : err,
    )
    available = false
    return null
  }
}
