// ============================================================
// Public-API broadcast core.
//
// Splits a broadcast into two phases so the HTTP route can persist +
// acknowledge fast and fan out afterwards (in `after()`):
//
//   createBroadcast()  — validate, resolve contacts, insert the
//                        `broadcasts` row + `broadcast_recipients`
//                        rows (status 'pending'), return a plan.
//   deliverBroadcast() — render each recipient's template locally and
//                        send it via the account's Evolution instance,
//                        stamping each recipient row + finalizing status.
//
// The free backend has no Meta template-approval system, so "templates"
// are local snippets: the body's {{1}} placeholders are substituted with
// each recipient's params and sent as a normal text (or media) message.
//
// Recipient rows carry `whatsapp_message_id`, so the inbound webhook's
// ack handler (which matches on that column) updates delivered/read for
// API broadcasts exactly as it does for dashboard ones.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { sendText, sendMedia } from '@/lib/whatsapp/provider/evolution';
import { whichAreOnWhatsApp } from '@/lib/whatsapp/provider/number-check';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { getDefaultInstanceName } from '@/lib/whatsapp/resolve-send-target';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import type { MessageTemplate } from '@/types';
import { findOrCreateContact } from '@/lib/api/v1/contacts';

/** Substitute {{1}}, {{2}}… placeholders with positional params. */
function substituteParams(text: string, params: string[]): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => params[Number(n) - 1] ?? `{{${n}}}`);
}

/** Render a snippet (optional text header + body + footer) to plain text. */
export function renderTemplateText(t: MessageTemplate | null, params: string[]): string {
  if (!t) return params.join(' ').trim();
  const parts: string[] = [];
  if (t.header_type === 'text' && t.header_content) parts.push(`*${t.header_content}*`);
  if (t.body_text) parts.push(substituteParams(t.body_text, params));
  if (t.footer_text) parts.push(t.footer_text);
  return parts.join('\n\n');
}

/** If the snippet has a media header with a usable URL, return it. */
export function templateMedia(
  t: MessageTemplate | null,
): { url: string; kind: 'image' | 'video' | 'document' } | null {
  if (!t || !t.header_type || t.header_type === 'text') return null;
  const url =
    t.header_media_url ||
    (t.header_content && /^https?:\/\//.test(t.header_content) ? t.header_content : null);
  if (!url) return null;
  return { url, kind: t.header_type };
}

/** Thrown by createBroadcast on a caller-visible failure; route maps it. */
export class BroadcastError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'BroadcastError';
    this.code = code;
    this.status = status;
  }
}

export interface BroadcastRecipientInput {
  /** E.164 phone. */
  to: string;
  /** Positional body params for the template ({{1}}, {{2}}…). */
  params?: string[];
}

export interface CreateBroadcastParams {
  name?: string | null;
  templateName: string;
  templateLanguage?: string | null;
  recipients: BroadcastRecipientInput[];
}

interface PlannedRecipient {
  recipientRowId: string;
  contactId: string;
  phone: string;
  params: string[];
}

export interface BroadcastPlan {
  broadcastId: string;
  templateName: string;
  templateLanguage: string;
  /** The account's Evolution instance the messages are sent from. */
  instanceName: string;
  templateRow: MessageTemplate | null;
  planned: PlannedRecipient[];
  /** Phones rejected up front (invalid E.164) — counted as failed. */
  rejected: number;
}

const MAX_RECIPIENTS = 1000;

/**
 * Validate + persist a broadcast, resolving each recipient to a
 * contact. Returns a plan for {@link deliverBroadcast}. Throws
 * {@link BroadcastError} on bad input / missing config / a malformed
 * template / a DB failure — nothing is sent in this phase.
 */
export async function createBroadcast(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  params: CreateBroadcastParams
): Promise<BroadcastPlan> {
  const { name, templateName, recipients } = params;
  const templateLanguage = params.templateLanguage || 'en_US';

  if (!templateName) {
    throw new BroadcastError('bad_request', "'template_name' is required", 400);
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new BroadcastError(
      'bad_request',
      "'recipients' must be a non-empty array of { to, params? }",
      400
    );
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw new BroadcastError(
      'bad_request',
      `A broadcast is capped at ${MAX_RECIPIENTS} recipients per request; split larger sends`,
      400
    );
  }

  // Broadcasts go out from the account's default number.
  const instanceName = await getDefaultInstanceName(db, accountId);
  if (!instanceName) {
    throw new BroadcastError(
      'whatsapp_not_configured',
      'WhatsApp not connected. Scan the QR code in Settings first.',
      400
    );
  }

  // Template row (once) for header/button components; guard a
  // malformed local row rather than N identical opaque failures.
  const { data: rawTemplateRow } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', templateName)
    .eq('language', templateLanguage)
    .maybeSingle();
  if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
    throw new BroadcastError(
      'template_malformed',
      'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
      500
    );
  }
  const templateRow = (rawTemplateRow as MessageTemplate | null) ?? null;

  // Resolve each recipient to a contact. Invalid phones are dropped
  // (counted as rejected) rather than aborting the whole broadcast.
  const resolved: { contactId: string; phone: string; params: string[] }[] = [];
  let rejected = 0;
  for (const r of recipients) {
    const sanitized = sanitizePhoneForMeta(typeof r.to === 'string' ? r.to : '');
    if (!isValidE164(sanitized)) {
      rejected++;
      continue;
    }
    const { id } = await findOrCreateContact(db, accountId, auditUserId, {
      phone: sanitized,
    });
    resolved.push({
      contactId: id,
      phone: sanitized,
      params: Array.isArray(r.params)
        ? r.params.filter((p): p is string => typeof p === 'string')
        : [],
    });
  }

  // Collapse recipients that resolved to the SAME contact (the caller
  // listed a phone twice, or two numbers fuzzy-matched to one contact).
  // Keep the first occurrence so the contact is messaged once and its
  // params aren't silently overwritten by a later duplicate — and so
  // the row↔params pairing below (keyed by contact_id) is unambiguous.
  const seenContact = new Set<string>();
  const deduped = resolved.filter((r) => {
    if (seenContact.has(r.contactId)) return false;
    seenContact.add(r.contactId);
    return true;
  });

  if (deduped.length === 0) {
    throw new BroadcastError(
      'bad_request',
      'No recipients had a valid E.164 phone number',
      400
    );
  }

  // Persist the broadcast + its recipients. The count columns
  // (sent/delivered/read/replied/failed) are owned by the DB aggregate
  // trigger (migrations 003/005) and derived purely from
  // broadcast_recipients rows — we deliberately do NOT seed them here
  // (a manual value would be clobbered by the trigger on the first
  // recipient change). `rejected` phones have no recipient row, so they
  // are reported to the caller in the POST response, not in these
  // persisted counts.
  const { data: broadcast, error: bErr } = await db
    .from('broadcasts')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      name: name || `API broadcast (${templateName})`,
      template_name: templateName,
      template_language: templateLanguage,
      status: 'sending',
      total_recipients: deduped.length,
    })
    .select('id')
    .single();
  if (bErr || !broadcast) {
    console.error('[broadcast-core] create broadcast error:', bErr);
    throw new BroadcastError('internal', 'Failed to create broadcast', 500);
  }

  const { data: recipientRows, error: rErr } = await db
    .from('broadcast_recipients')
    .insert(
      deduped.map((r) => ({
        broadcast_id: broadcast.id,
        contact_id: r.contactId,
        status: 'pending' as const,
      }))
    )
    .select('id, contact_id');
  if (rErr || !recipientRows) {
    console.error('[broadcast-core] create recipients error:', rErr);
    throw new BroadcastError('internal', 'Failed to create broadcast', 500);
  }

  // Pair each inserted recipient row back to its phone/params by
  // contact_id — unambiguous now that duplicates are collapsed.
  const byContact = new Map(deduped.map((r) => [r.contactId, r]));
  const planned: PlannedRecipient[] = recipientRows.map((row) => {
    const r = byContact.get(row.contact_id as string)!;
    return {
      recipientRowId: row.id as string,
      contactId: row.contact_id as string,
      phone: r.phone,
      params: r.params,
    };
  });

  return {
    broadcastId: broadcast.id,
    templateName,
    templateLanguage,
    instanceName,
    templateRow,
    planned,
    rejected,
  };
}

/**
 * Fan out a {@link BroadcastPlan}: send each recipient's template
 * (phone-variant retry) and stamp its `broadcast_recipients` row.
 * Best-effort per recipient — one failure never aborts the rest.
 * Designed to run inside `after()`.
 *
 * The per-status count columns on `broadcasts` are owned by the DB
 * aggregate trigger (migrations 003/005): each recipient-row update
 * below advances them automatically, and later delivery/read acks keep
 * advancing them. We therefore never write those columns here — only the
 * terminal `status` — otherwise a manual value would race and clobber the
 * trigger-maintained counts.
 */
export async function deliverBroadcast(
  db: SupabaseClient,
  plan: BroadcastPlan
): Promise<void> {
  let sentCount = 0;

  // The media header (if any) is identical for every recipient; only the
  // body params vary. Resolve it once.
  const media = templateMedia(plan.templateRow);

  // One batched WhatsApp-number check for the whole broadcast. Recipients
  // definitively not on WhatsApp are marked failed without a send attempt.
  const onWa = await whichAreOnWhatsApp(
    plan.instanceName,
    plan.planned.map((r) => r.phone),
  );

  // Cache the check results on the contacts (drives the inbox badge) —
  // two bulk writes for the whole broadcast.
  const now = new Date().toISOString();
  const trueIds = plan.planned
    .filter((r) => onWa.get(r.phone.replace(/\D/g, '')) === true)
    .map((r) => r.contactId);
  const falseIds = plan.planned
    .filter((r) => onWa.get(r.phone.replace(/\D/g, '')) === false)
    .map((r) => r.contactId);
  if (trueIds.length) {
    await db
      .from('contacts')
      .update({ is_on_whatsapp: true, whatsapp_checked_at: now })
      .in('id', trueIds);
  }
  if (falseIds.length) {
    await db
      .from('contacts')
      .update({ is_on_whatsapp: false, whatsapp_checked_at: now })
      .in('id', falseIds);
  }

  for (const recipient of plan.planned) {
    const text = renderTemplateText(plan.templateRow, recipient.params);
    const toDigits = recipient.phone.replace(/\D/g, '');

    if (onWa.get(toDigits) === false) {
      await db
        .from('broadcast_recipients')
        .update({ status: 'failed', error_message: 'Not a WhatsApp number' })
        .eq('id', recipient.recipientRowId);
      continue;
    }

    let sentMessageId: string | null = null;
    let lastError: string | null = null;

    try {
      if (media) {
        const result = await sendMedia({
          instanceName: plan.instanceName,
          to: toDigits,
          kind: media.kind,
          media: media.url,
          caption: text || undefined,
        });
        sentMessageId = result.messageId;
      } else {
        const result = await sendText({
          instanceName: plan.instanceName,
          to: toDigits,
          text,
        });
        sentMessageId = result.messageId;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
    }

    if (sentMessageId) {
      sentCount++;
      await db
        .from('broadcast_recipients')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          whatsapp_message_id: sentMessageId,
          error_message: null,
        })
        .eq('id', recipient.recipientRowId);
    } else {
      await db
        .from('broadcast_recipients')
        .update({
          status: 'failed',
          error_message: lastError || 'Unknown error',
        })
        .eq('id', recipient.recipientRowId);
    }
  }

  // Terminal status only — counts are trigger-owned (see the note
  // above). If nothing sent, the broadcast failed outright; a partial
  // send is still 'sent' (per-recipient failures show in failed_count).
  await db
    .from('broadcasts')
    .update({
      status: sentCount > 0 ? 'sent' : 'failed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', plan.broadcastId);
}
