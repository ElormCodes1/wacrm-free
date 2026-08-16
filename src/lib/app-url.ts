/**
 * The app's own public address.
 *
 * This exists because a wrong answer is expensive: it goes into password
 * reset and confirmation emails, and a link to 0.0.0.0:3000 or to a
 * developer's laptop is a link nobody can follow. window.location.origin
 * is not good enough — Next prints http://0.0.0.0:3000 as its network
 * address, 0.0.0.0 is a BIND address rather than somewhere you can browse
 * to, and anyone who opens that URL then generates emails pointing at it.
 *
 * Order matters. An explicitly configured URL wins, because the person
 * who set it knows something the process does not. The platform-generated
 * variables come next — and several names are tried, because the value
 * lands in the un-suffixed one often enough to matter. The request's own
 * Host header is the last resort: it is what the visitor actually typed,
 * which is usually right and always better than a guess.
 */

const ENV_KEYS = [
  'APP_URL',
  'NEXT_PUBLIC_APP_URL',
  'SERVICE_FQDN_APP_3000',
  'SERVICE_URL_APP_3000',
  'SERVICE_FQDN_APP',
  'SERVICE_URL_APP',
] as const;

/**
 * Turn whatever was configured into an origin, or null.
 *
 * Platforms hand this over as either `https://host` or a bare `host`
 * depending on version, and a bare host concatenated onto a path produces
 * `host/auth/callback`, which is not a URL. Anything that will not parse
 * is treated as unset rather than passed on.
 */
export function normaliseOrigin(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    // 0.0.0.0 means "every interface" to a server and nothing at all to a
    // browser. Point it at the loopback name a person can actually open.
    if (url.hostname === '0.0.0.0') url.hostname = 'localhost';
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Server side: the address this deployment answers on. */
export function configuredOrigin(): string | null {
  for (const key of ENV_KEYS) {
    const origin = normaliseOrigin(process.env[key]);
    if (origin) return origin;
  }
  return null;
}

/**
 * Browser side: the origin to put in an emailed link.
 *
 * Takes the server's answer when there is one and falls back to the
 * address in the address bar, normalised — so a developer who opened
 * 0.0.0.0:3000 still gets links they can follow.
 */
export function emailLinkOrigin(serverOrigin?: string | null): string {
  const fromServer = normaliseOrigin(serverOrigin);
  if (fromServer) return fromServer;
  if (typeof window !== 'undefined') {
    return normaliseOrigin(window.location.origin) ?? window.location.origin;
  }
  return '';
}
