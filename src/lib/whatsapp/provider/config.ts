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

// ============================================================
// Instance → account resolution (cached)
//
// Every inbound Evolution event — messages, presence, receipts, labels,
// calls — starts by turning an instance name into the owning account. That
// was one uncached SELECT per event against a DB that may be a continent
// away, on the critical path before the message row is written.
//
// The mapping is effectively immutable: a row's account_id/user_id never
// change, only the row's existence does. So a short TTL is enough, and the
// two events that *do* change existence are handled directly — linking a
// number caches nothing (misses fall through to the DB), and unlinking
// calls `invalidateInstanceConfig`.
// ============================================================

export interface InstanceConfig {
  id: string
  account_id: string
  user_id: string
}

/**
 * Hits are cheap to keep — the row is immutable while it exists. Misses
 * expire fast: a miss cached too long would drop the first messages of a
 * number that was linked moments ago.
 */
const HIT_TTL_MS = 60_000
const MISS_TTL_MS = 5_000

const cache = new Map<string, { value: InstanceConfig | null; expiresAt: number }>()

/**
 * Drop a cached mapping. Call when a number is unlinked, so in-flight
 * events stop resolving to an account whose config row is gone. Omit the
 * argument to clear everything (tests).
 */
export function invalidateInstanceConfig(instanceName?: string): void {
  if (instanceName === undefined) cache.clear()
  else cache.delete(instanceName)
}

/**
 * Resolve an Evolution instance name to its owning account, memoised.
 *
 * `query` is the DB read, injected rather than imported so this module
 * stays free of a Supabase client (the webhook route builds its own
 * service-role one lazily).
 */
export async function resolveInstanceConfig(
  instanceName: string,
  query: (instanceName: string) => Promise<InstanceConfig | null>,
  now: number = Date.now(),
): Promise<InstanceConfig | null> {
  const hit = cache.get(instanceName)
  if (hit && hit.expiresAt > now) return hit.value

  const value = await query(instanceName)
  cache.set(instanceName, {
    value,
    expiresAt: now + (value ? HIT_TTL_MS : MISS_TTL_MS),
  })
  return value
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
