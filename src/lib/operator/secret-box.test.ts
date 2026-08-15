import { describe, it, expect, beforeAll } from 'vitest';

import { sealSecret, openSecret } from './secret-box';

beforeAll(() => {
  process.env.OPERATOR_SESSION_SECRET = 'x'.repeat(48);
});

describe('secret-box', () => {
  it('round-trips a secret', () => {
    const s = 'JBSWY3DPEHPK3PXP';
    expect(openSecret(sealSecret(s))).toBe(s);
  });

  it('produces a different ciphertext each time', () => {
    // A deterministic ciphertext would let anyone with the table see which
    // operators share a secret, or that one was reset to the same value.
    const a = sealSecret('JBSWY3DPEHPK3PXP');
    const b = sealSecret('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(b);
    expect(openSecret(a)).toBe(openSecret(b));
  });

  it('refuses a tampered ciphertext instead of returning something else', () => {
    const sealed = sealSecret('JBSWY3DPEHPK3PXP');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(openSecret(parts.join('.'))).toBeNull();
  });

  it('refuses a swapped auth tag', () => {
    const a = sealSecret('AAAAAAAAAAAAAAAA').split('.');
    const b = sealSecret('BBBBBBBBBBBBBBBB').split('.');
    a[2] = b[2];
    expect(openSecret(a.join('.'))).toBeNull();
  });

  it('returns null for junk rather than throwing', () => {
    // A corrupt row must not turn a sign-in into a 500.
    for (const bad of ['', 'nonsense', 'v1.only.three', 'v2.a.b.c']) {
      expect(openSecret(bad)).toBeNull();
    }
    expect(openSecret(null)).toBeNull();
    expect(openSecret(undefined)).toBeNull();
  });

  it('cannot be opened with a different master secret', () => {
    const sealed = sealSecret('JBSWY3DPEHPK3PXP');
    process.env.OPERATOR_SESSION_SECRET = 'y'.repeat(48);
    expect(openSecret(sealed)).toBeNull();
    process.env.OPERATOR_SESSION_SECRET = 'x'.repeat(48);
  });
});
