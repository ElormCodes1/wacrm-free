import { headers } from 'next/headers';

import { configuredOrigin, normaliseOrigin } from '@/lib/app-url';
import { ForgotPasswordForm } from './forgot-password-form';

/**
 * Resolves the address to put in the reset email, on the server.
 *
 * The browser's own origin is not a safe source for this: Next advertises
 * itself as http://0.0.0.0:3000, and anybody who opens that then mails
 * themselves a link nobody can follow. What the deployment was configured
 * with wins; the Host header the visitor actually reached us on is the
 * fallback, which is right far more often than a guess.
 */
export default async function ForgotPasswordPage() {
  const configured = configuredOrigin();

  let fromRequest: string | null = null;
  if (!configured) {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    const proto = h.get('x-forwarded-proto') ?? 'https';
    // Normalised here so the value that reaches the browser is already
    // one a person could open — 0.0.0.0 never leaves this function.
    if (host) fromRequest = normaliseOrigin(`${proto}://${host}`);
  }

  return <ForgotPasswordForm appOrigin={configured ?? fromRequest} />;
}
