// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact + WhatsApp config,
//   3. sends to Meta (with phone-variant retry + contact auto-fix),
//   4. persists the message + updates the conversation,
//   5. pauses any active Flow run for the contact (agent stepped in).
//
// It is transport-agnostic: it takes a `SupabaseClient` and an
// `accountId` and throws `SendMessageError` on failure. The callers
// own auth, rate-limiting, body parsing, and mapping the error to
// their respective response shapes (internal `{ error }` vs the v1
// envelope). Behaviour is identical to the original inline route —
// this is a straight extraction so the public endpoint can reuse it
// without duplicating ~250 lines of Meta plumbing.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendText,
  sendMedia,
  type EvolutionMediaKind,
} from '@/lib/whatsapp/provider/evolution';
import { isOnWhatsApp } from '@/lib/whatsapp/provider/number-check';
import { instanceForConversation } from '@/lib/whatsapp/resolve-send-target';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  sanitizePhoneForMeta,
  isValidE164,
} from '@/lib/whatsapp/phone-utils';
import type { MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  ...MEDIA_KINDS,
] as const;

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape (`toErrorResponse` for
 * the dashboard route, the v1 envelope for the public endpoint).
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). */
  templateMessageParams?: unknown;
  replyToMessageId?: string | null;
  /** Send image/video as "view once" (disappears after one open). */
  viewOnce?: boolean;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** The WhatsApp message id (Baileys `key.id`) from Evolution. */
  whatsappMessageId: string;
}

/**
 * Interim template rendering for the free backend.
 *
 * Meta's approved-template system does not exist on Baileys/Evolution, so
 * a "template" send is rendered locally: substitute the numbered
 * placeholders (`{{1}}`, `{{2}}`, …) in the stored body with the supplied
 * params and send it as a plain text message. Header media and buttons are
 * handled in the templates→snippets phase.
 */
function renderTemplateBody(
  template: MessageTemplate | null,
  params?: string[],
): string {
  if (!template?.body_text) {
    throw new SendMessageError(
      'template_not_found',
      'Template not found or has no body to send.',
      400,
    );
  }
  const values = params ?? [];
  let text = template.body_text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => {
    const idx = Number(n) - 1;
    return values[idx] ?? `{{${n}}}`;
  });
  if (template.footer_text) text += `\n\n${template.footer_text}`;
  return text;
}

/**
 * Send a message in an existing conversation and persist it.
 *
 * `db` may be an RLS-scoped user client (dashboard) or the service-
 * role client (public API) — every query is filtered by `accountId`
 * either way, so tenancy holds regardless of which client is passed.
 */
/**
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload. Exported so a caller can reject a malformed request
 * *before* it finds-or-creates a contact/conversation — otherwise an
 * invalid payload leaves an orphan empty conversation behind. The send
 * core calls this too, so validation can't be skipped.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
}): void {
  const { messageType, contentText, mediaUrl, templateName } = params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'bad_request',
      `Unsupported message_type "${messageType}"`,
      400
    );
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }

  if (messageType === 'template' && !templateName) {
    throw new SendMessageError(
      'bad_request',
      'template_name is required for template messages',
      400
    );
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url is required for ${messageType} messages`,
      400
    );
  }

  // Meta caps media captions at 1024 chars (audio carries none).
  if (
    isMediaKind &&
    messageType !== 'audio' &&
    typeof contentText === 'string' &&
    contentText.length > 1024
  ) {
    throw new SendMessageError(
      'bad_request',
      'Caption exceeds the 1024-character limit',
      400
    );
  }
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    templateParams,
    replyToMessageId,
    viewOnce,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400
    );
  }

  validateSendMessageParams({ messageType, contentText, mediaUrl, templateName });

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  // Conversation + contact, account-scoped.
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  const contact = conversation.contact;
  if (!contact?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Contact phone number not found',
      400
    );
  }

  // Groups are addressed by "<groupId>@g.us"; 1:1 chats by validated
  // digits. Group ids aren't E.164, so skip phone validation for them.
  const isGroup = contact.is_group === true;
  let toDigits: string;
  if (isGroup) {
    toDigits = `${contact.phone.replace(/\D/g, '')}@g.us`;
  } else {
    const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
    if (!isValidE164(sanitizedPhone)) {
      throw new SendMessageError('bad_request', 'Invalid phone number format', 400);
    }
    toDigits = sanitizedPhone.replace(/\D/g, '');
  }

  // Send from the number this conversation is on (multi-number), falling
  // back to the account's default number.
  const instanceName = await instanceForConversation(
    db,
    accountId,
    (conversation.whatsapp_config_id as string | null) ?? null,
  );
  if (!instanceName) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp is not connected. Connect a number in Settings first.',
      400
    );
  }

  // Resolve the reply target to its Meta message_id. The parent must
  // belong to this same conversation — otherwise a caller could quote
  // messages they can't see by guessing UUIDs.
  let contextMessageId: string | undefined;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('message_id, conversation_id')
      .eq('id', replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (parentError || !parent) {
      throw new SendMessageError(
        'bad_request',
        'reply_to_message_id not found in this conversation',
        400
      );
    }
    if (!parent.message_id) {
      console.warn(
        '[send-message] reply target has no Meta message_id; sending without context'
      );
    } else {
      contextMessageId = parent.message_id;
    }
  }

  // Template row (for header + button components). isMessageTemplate
  // guards against a malformed local row crashing the send-builder.
  let templateRow: MessageTemplate | null = null;
  if (messageType === 'template' && templateName) {
    const { data } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', templateName)
      .eq('language', templateLanguage || 'en_US')
      .maybeSingle();
    if (data && !isMessageTemplate(data)) {
      throw new SendMessageError(
        'template_malformed',
        'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
        500
      );
    }
    templateRow = data ?? null;
  }

  // Validate the number is on WhatsApp ONLY before the very first message
  // to this conversation. A contact who has already exchanged a message
  // (inbound or a prior successful send) is provably on WhatsApp, so
  // re-checking on every send would be wasted work. Only a definitive
  // `false` blocks; an unknown result (check failed) lets the send
  // proceed.
  const { count: priorMessageCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);
  const isFirstMessage = (priorMessageCount ?? 0) === 0;

  // Groups have no single number to validate — skip the WhatsApp check.
  if (isFirstMessage && !isGroup) {
    const onWa = await isOnWhatsApp(instanceName, toDigits);
    // Cache a definitive result on the contact (drives the inbox badge).
    if (onWa === true || onWa === false) {
      await db
        .from('contacts')
        .update({ is_on_whatsapp: onWa, whatsapp_checked_at: new Date().toISOString() })
        .eq('id', contact.id);
    }
    if (onWa === false) {
      throw new SendMessageError(
        'not_on_whatsapp',
        'This number is not registered on WhatsApp.',
        422,
      );
    }
  }

  const attempt = async (): Promise<string> => {
    if (messageType === 'template') {
      const text = renderTemplateBody(templateRow, templateParams);
      const result = await sendText({
        instanceName,
        to: toDigits,
        text,
        quotedMessageId: contextMessageId,
      });
      return result.messageId;
    }
    if (isMediaKind) {
      const result = await sendMedia({
        instanceName,
        to: toDigits,
        kind: messageType as EvolutionMediaKind,
        media: mediaUrl!,
        caption: contentText || undefined,
        fileName: filename || undefined,
        quotedMessageId: contextMessageId,
        // View-once only applies to image/video; harmless on others (the
        // composer only offers it for those two).
        viewOnce: viewOnce || undefined,
      });
      return result.messageId;
    }
    const result = await sendText({
      instanceName,
      to: toDigits,
      text: contentText!,
      quotedMessageId: contextMessageId,
    });
    return result.messageId;
  };

  // Send via the self-hosted Evolution instance. Baileys resolves the
  // recipient JID from the digits, so there is no Meta-style
  // "recipient not in allowed list" retry to do here.
  let waMessageId = '';
  try {
    waMessageId = await attempt();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown send error';
    console.error('[send-message] Evolution send failed:', message);
    throw new SendMessageError('send_error', `WhatsApp send failed: ${message}`, 502);
  }

  // Persist the sent message. Field names MUST match the messages
  // schema (see 001_initial_schema.sql).
  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: messageType,
      content_text: contentText || null,
      media_url: mediaUrl || null,
      template_name: templateName || null,
      message_id: waMessageId,
      status: 'sent',
      reply_to_message_id: replyToMessageId || null,
    })
    .select()
    .single();

  if (msgError) {
    console.error('[send-message] error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent to Meta but failed to save to DB: ${msgError.message}`,
      500
    );
  }

  await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${messageType}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  // Pause any active Flow run for this contact — the agent stepping in
  // is the strongest "yield, human is here" signal. Best-effort.
  try {
    const { error: pauseErr } = await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'active');
    if (pauseErr) {
      console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
    }
  } catch (err) {
    console.error(
      '[flows] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err
    );
  }

  return { messageId: messageRecord.id, whatsappMessageId: waMessageId };
}
