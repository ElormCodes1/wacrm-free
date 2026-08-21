import { NextResponse } from 'next/server';

import { configuredOrigin, originForRedirect } from '@/lib/app-url';

/**
 * What this deployment actually resolved.
 *
 * Exists because "is that variable set in production?" has been asked
 * repeatedly and could not be answered: the platform's API returns every
 * value as EMPTY whether or not it is populated, and reading the
 * container's environment needs a shell nobody has to hand. The only
 * reliable witness is the app itself.
 *
 * Unauthenticated on purpose. Everything here is either already public
 * (the origin is the address used to reach this endpoint) or reported as
 * a yes/no rather than a value. No secret is echoed — not the service
 * role key, not the gateway key, not the session secret. Where a URL is
 * shown it is reduced to scheme and host, because a path can carry a
 * token and a hostname cannot.
 */
export const dynamic = 'force-dynamic';

/** Host and scheme only. A URL's path may carry a secret; its host will not. */
function hostOnly(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'set (unparseable)';
  }
}

export async function GET(request: Request) {
  const evolutionUrl = process.env.EVOLUTION_API_URL;
  const webhookUrl = process.env.EVOLUTION_WEBHOOK_URL;

  return NextResponse.json({
    ok: true,
    // Which address the app believes it lives at, and where that came
    // from — the thing that decides what goes into an emailed link.
    origin: {
      resolved: originForRedirect(request),
      fromConfig: configuredOrigin(),
      https: originForRedirect(request).startsWith('https://'),
    },
    // The gateway wiring, which is what breaks when a compose override is
    // missing: localhost here means the app is looking for Evolution
    // inside its own container.
    whatsapp: {
      apiUrl: hostOnly(evolutionUrl),
      webhookUrl: hostOnly(webhookUrl),
      apiKeySet: Boolean(process.env.EVOLUTION_API_KEY),
      webhookSecretSet: Boolean(process.env.EVOLUTION_WEBHOOK_SECRET),
    },
    // Presence only, never values.
    config: {
      supabaseUrl: hostOnly(process.env.NEXT_PUBLIC_SUPABASE_URL),
      supabaseAnonKeySet: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      supabaseServiceKeySet: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      operatorSecretSet: Boolean(process.env.OPERATOR_SESSION_SECRET),
      encryptionKeySet: Boolean(process.env.ENCRYPTION_KEY),
      healthTokenSet: Boolean(process.env.WHATSAPP_HEALTH_TOKEN),
    },
  });
}
