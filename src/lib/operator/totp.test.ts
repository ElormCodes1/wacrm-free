import { describe, it, expect } from 'vitest';

import {
  base32Encode,
  base32Decode,
  hotp,
  totp,
  verifyTotp,
  generateTotpSecret,
  otpauthUri,
} from './totp';

/**
 * The published vectors are the point of this file.
 *
 * A TOTP implementation that is subtly wrong still produces six plausible
 * digits, and the failure only shows up as "the code from my phone never
 * works" — from a person who is by then locked out of the operator
 * console. Checking against RFC 4226 and RFC 6238 is the only way to know
 * the arithmetic agrees with what every authenticator app computes.
 */

// RFC 4226 Appendix D — ASCII "12345678901234567890".
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('HOTP — RFC 4226 test vectors', () => {
  const expected = [
    '755224', '287082', '359152', '969429', '338314',
    '254676', '287922', '162583', '399871', '520489',
  ];

  it.each(expected.map((code, counter) => [counter, code]))(
    'counter %i produces %s',
    (counter, code) => {
      expect(hotp(RFC_SECRET, counter as number)).toBe(code);
    }
  );
});

describe('TOTP — RFC 6238 test vectors', () => {
  // The RFC tabulates 8-digit codes; the implementation is parameterised
  // so the same arithmetic can be checked against them directly.
  const vectors: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  it.each(vectors)('T=%i produces %s', (seconds, code) => {
    const secret = base32Encode(RFC_SECRET);
    expect(totp(secret, seconds * 1000, 8)).toBe(code);
  });

  it('agrees with the 64-bit counter beyond 2^32 seconds', () => {
    // The last vector is past 2038; getting the high word wrong breaks
    // silently and only in the future.
    expect(totp(base32Encode(RFC_SECRET), 20000000000 * 1000, 8)).toBe('65353130');
  });
});

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    for (const input of ['', 'a', 'ab', 'abc', 'abcd', 'abcde', 'hello world']) {
      const buf = Buffer.from(input);
      expect(base32Decode(base32Encode(buf)).toString()).toBe(input);
    }
  });

  it('accepts the spaced, padded form people paste back', () => {
    const secret = base32Encode(RFC_SECRET);
    const spaced = secret.replace(/(.{4})/g, '$1 ').trim() + '==';
    expect(base32Decode(spaced).equals(RFC_SECRET)).toBe(true);
  });

  it('rejects characters that are not base32', () => {
    // '1', '8' and '0' are excluded from the alphabet precisely because
    // they are misread as I, B and O.
    expect(() => base32Decode('ABC1')).toThrow();
  });
});

describe('verifyTotp', () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;

  it('accepts the current code', () => {
    expect(verifyTotp(secret, totp(secret, now), now)).toBe(true);
  });

  it('accepts one step either side, for clock drift', () => {
    // A code typed at second 29 arrives at second 31.
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now + 30_000), now)).toBe(true);
  });

  it('refuses codes further out than the drift window', () => {
    expect(verifyTotp(secret, totp(secret, now - 90_000), now)).toBe(false);
    expect(verifyTotp(secret, totp(secret, now + 90_000), now)).toBe(false);
  });

  it('refuses anything that is not six digits', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56x', '000000000']) {
      expect(verifyTotp(secret, bad, now), `"${bad}" should be refused`).toBe(false);
    }
  });

  it('tolerates a space typed in the middle', () => {
    const code = totp(secret, now);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(true);
  });

  it('refuses another secret’s code', () => {
    const other = generateTotpSecret();
    expect(verifyTotp(secret, totp(other, now), now)).toBe(false);
  });
});

describe('generateTotpSecret', () => {
  it('produces a 160-bit secret, as RFC 4226 recommends', () => {
    expect(base32Decode(generateTotpSecret()).length).toBe(20);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(seen.size).toBe(50);
  });
});

describe('otpauthUri', () => {
  it('carries everything an app needs to match our codes', () => {
    const uri = otpauthUri('ABCDEFGH', 'ops@example.com');
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain('secret=ABCDEFGH');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('escapes the account so a colon cannot break the label', () => {
    expect(otpauthUri('ABC', 'a:b@example.com')).toContain('%3A');
  });
});
