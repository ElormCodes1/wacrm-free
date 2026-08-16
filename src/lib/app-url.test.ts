import { describe, it, expect } from 'vitest';

import { normaliseOrigin, emailLinkOrigin } from './app-url';

describe('normaliseOrigin', () => {
  it('rewrites the bind address to something a browser can open', () => {
    // This is the actual bug: Next prints http://0.0.0.0:3000 as its
    // network address, and a link to it in an email goes nowhere.
    expect(normaliseOrigin('http://0.0.0.0:3000')).toBe('http://localhost:3000');
  });

  it('adds a scheme to a bare host', () => {
    // Platforms hand the domain over both ways depending on version, and
    // a bare host concatenated onto a path is not a URL at all.
    expect(normaliseOrigin('wacrm.ceess.net')).toBe('https://wacrm.ceess.net');
  });

  it('reduces a full URL to its origin', () => {
    expect(normaliseOrigin('https://wacrm.ceess.net/some/path?x=1')).toBe(
      'https://wacrm.ceess.net'
    );
  });

  it('keeps a non-default port', () => {
    expect(normaliseOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('treats junk and blanks as unset rather than passing them on', () => {
    for (const bad of ['', '   ', null, undefined, 'http://', '://nope']) {
      expect(normaliseOrigin(bad as string | null)).toBeNull();
    }
  });

  it('trims whitespace a config file leaves behind', () => {
    expect(normaliseOrigin('  https://wacrm.ceess.net  ')).toBe('https://wacrm.ceess.net');
  });
});

describe('emailLinkOrigin', () => {
  it('prefers what the server resolved', () => {
    expect(emailLinkOrigin('https://wacrm.ceess.net')).toBe('https://wacrm.ceess.net');
  });

  it('normalises the server value too', () => {
    expect(emailLinkOrigin('wacrm.ceess.net')).toBe('https://wacrm.ceess.net');
  });

  it('falls back when the server had nothing', () => {
    // No window in this environment, so the fallback is empty rather than
    // a guess — callers must not paste a wrong host into an email.
    expect(emailLinkOrigin(null)).toBe('');
    expect(emailLinkOrigin(undefined)).toBe('');
  });
});
