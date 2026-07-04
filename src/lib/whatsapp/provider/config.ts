/**
 * Shared helpers that map a wacrm-free account onto an Evolution instance
 * and describe the webhook Evolution should call back.
 *
 * Kept separate from `evolution.ts` (the transport client) so both the
 * config API routes and the inbound webhook route can agree on the same
 * instance-naming and webhook conventions.
 */

import { DEFAULT_WEBHOOK_EVENTS, type WebhookConfig } from './evolution'

/**
 * Deterministic Evolution instance name for an account. Stable across
 * reconnects so an account always owns exactly one instance. account_id
 * is a UUID, which is already URL-safe.
 */
export function instanceNameForAccount(accountId: string): string {
  return `wacrm-${accountId}`
}

/**
 * The webhook Evolution posts inbound events to. This URL must be
 * reachable *from the Evolution server*. In local Docker dev that means
 * `http://host.docker.internal:3000/api/whatsapp/webhook` (the Next dev
 * server on the host), NOT `localhost` (which, inside the container,
 * is the container itself). Set EVOLUTION_WEBHOOK_URL accordingly.
 */
export function appWebhookConfig(): WebhookConfig {
  const url = process.env.EVOLUTION_WEBHOOK_URL
  if (!url) {
    throw new Error(
      'EVOLUTION_WEBHOOK_URL is not set. Point it at this app\'s webhook endpoint ' +
        'as seen from the Evolution server (e.g. http://host.docker.internal:3000/api/whatsapp/webhook).',
    )
  }
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET
  return {
    url,
    events: [...DEFAULT_WEBHOOK_EVENTS],
    base64: true,
    ...(secret ? { headers: { 'x-evolution-secret': secret } } : {}),
  }
}
