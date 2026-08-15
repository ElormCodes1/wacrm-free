import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238), implemented here rather than pulled in.
 *
 * It is about sixty lines of well-specified arithmetic with published
 * test vectors, and this is the code standing between one stolen password
 * and every customer's data — a dependency here is a supply-chain hole in
 * the most sensitive path in the system, for the sake of code that fits
 * on a screen and cannot change.
 *
 * SHA-1 is not a mistake: RFC 6238 specifies HMAC-SHA1 and every
 * authenticator app implements that. The security of TOTP does not rest
 * on SHA-1's collision resistance, and an app that used SHA-256 would
 * simply produce codes nobody's phone agrees with.
 */

const DIGITS = 6;
const PERIOD_SECONDS = 30;

// ---------------------------------------------------------------- base32

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  // Authenticator apps show the secret in spaced groups and people paste
  // it back that way; padding is optional in the wild too.
  const clean = input.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---------------------------------------------------------------- totp

/** A fresh 160-bit secret, base32 encoded — the size RFC 4226 recommends. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * The code for a given counter. Exported for the RFC test vectors, which
 * specify counters rather than wall-clock times.
 */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const buf = Buffer.alloc(8);
  // JavaScript numbers cannot hold a 64-bit counter, but the high word
  // stays zero until the year 2^32 * 30 seconds from the epoch.
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac('sha1', secret).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];

  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

export function totp(secretBase32: string, atMs = Date.now(), digits = DIGITS): string {
  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
  return hotp(base32Decode(secretBase32), counter, digits);
}

/**
 * Check a submitted code.
 *
 * Accepts the neighbouring windows as well as the current one, because
 * phone clocks drift and a code typed at second 29 arrives at second 31.
 * One step either side is the usual compromise: ±30 seconds of tolerance
 * for a 3x larger guessing surface, which is 3 in a million.
 *
 * Compared in constant time. The comparison is against a code the server
 * computed, so a timing leak would reveal a valid code for the current
 * window — briefly useful to an attacker who is already guessing.
 */
export function verifyTotp(
  secretBase32: string,
  submitted: string,
  atMs = Date.now(),
  window = 1
): boolean {
  const cleaned = (submitted ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;

  const secret = base32Decode(secretBase32);
  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);

  let matched = false;
  for (let i = -window; i <= window; i++) {
    const candidate = hotp(secret, counter + i);
    const a = Buffer.from(candidate);
    const b = Buffer.from(cleaned);
    // No early exit: every window is compared even after a match, so the
    // time taken does not reveal WHICH window matched.
    if (a.length === b.length && timingSafeEqual(a, b)) matched = true;
  }
  return matched;
}

/**
 * The otpauth:// URI an authenticator app consumes.
 *
 * The issuer appears twice by convention — once as a label prefix and
 * once as a parameter — because apps disagree about which they read.
 */
export function otpauthUri(secretBase32: string, account: string, issuer = 'WaCRM Operator'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Grouped in fours so it can be read off a screen and typed by hand. */
export function formatSecretForDisplay(secretBase32: string): string {
  return secretBase32.replace(/(.{4})/g, '$1 ').trim();
}
