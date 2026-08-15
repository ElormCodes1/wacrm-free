import 'server-only';

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Encryption for the TOTP secrets at rest.
 *
 * The operators table is already unreachable through the customer API —
 * RLS on, no policy, service role only. That defends against the
 * application being wrong. It does not defend against the DATABASE being
 * read: a leaked backup or a stray service-role key would otherwise hand
 * over every operator's second factor, which is precisely the thing meant
 * to survive the first factor being stolen.
 *
 * AES-256-GCM, so a tampered ciphertext fails to decrypt rather than
 * decrypting to something else. The key is derived from
 * OPERATOR_SESSION_SECRET through HKDF with a distinct info string, so
 * the encryption key and the cookie-signing key are different keys even
 * though there is one secret to manage — reusing the same bytes for two
 * purposes is the classic way a break in one becomes a break in both.
 *
 * Consequence worth stating: rotating OPERATOR_SESSION_SECRET makes every
 * stored TOTP secret undecryptable, and enrolled operators must re-enrol
 * using a recovery code. That is the right trade for a handful of staff
 * accounts, but it is not free.
 */

function key(): Buffer {
  const secret = process.env.OPERATOR_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'OPERATOR_SESSION_SECRET must be set to at least 32 characters before ' +
        'operator two-factor secrets can be stored.'
    );
  }
  // Fixed salt: there is one long-lived key here, not per-record keys, and
  // the info string is what separates this from the signing key.
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret), Buffer.alloc(0), 'operator-totp-v1', 32));
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function sealSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join(
    '.'
  );
}

/** Returns null rather than throwing: a corrupt row must not 500 a sign-in. */
export function openSecret(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  try {
    const [version, ivB64, tagB64, dataB64] = sealed.split('.');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) return null;

    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
