/**
 * Preview of the address a company name will produce.
 *
 * The database is what actually assigns the address (it also has to check
 * reserved words and collisions, which the browser cannot see). This exists
 * so the signup form can show the customer what they are about to get while
 * they type — the address is the thing they will print, and discovering it
 * after the fact is how people end up with one they would not have chosen.
 *
 * Kept in step with public.slugify() in migration 065. If they disagree the
 * preview is merely optimistic, never authoritative.
 */
export function previewSlug(name: string): string {
  return name
    .normalize('NFD')
    // Strip combining marks so "Café" folds to "cafe" rather than losing
    // the letter entirely — matching unaccent() on the server.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36)
    .replace(/-+$/, '');
}

/** Whether a preview is long enough for the server to accept it as-is. */
export function isUsableSlug(slug: string): boolean {
  return slug.length >= 3;
}
