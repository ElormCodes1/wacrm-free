/**
 * Which company's sign-in to paint when a session ends.
 *
 * When someone's session expires they should come back to THEIR
 * company's branded sign-in — not a generic one, and not a page asking
 * which company they belong to, which is a question people cannot always
 * answer about their own employer.
 *
 * The value is a plain, unsigned cookie, and that is deliberate. It
 * decides one thing only: which logo and colour to paint on a form that
 * still demands a password. Tampering with it shows someone the wrong
 * company's sign-in page, where they must prove who they are exactly as
 * before — so it is not worth stealing, and does not need protecting like
 * a credential. Signing it would imply a trust it never carries.
 */
export const LAST_COMPANY_COOKIE = 'last_company';

/** A slug is lowercase letters, digits and hyphens — reject anything else. */
export function sanitiseCompanyHint(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(value)) return null;
  return value;
}
