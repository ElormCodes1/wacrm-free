import { describe, it, expect } from 'vitest';
import { previewSlug, isUsableSlug } from './slugify';

/**
 * The preview must match what the database derives, because the customer
 * decides their company name based on what this shows them — and the
 * address is permanent once issued. These cases mirror the ones checked
 * against public.slugify() directly.
 */
describe('previewSlug', () => {
  it('turns an ordinary company name into an address', () => {
    expect(previewSlug('Bright Motors Ltd')).toBe('bright-motors-ltd');
  });

  it('drops punctuation rather than encoding it', () => {
    expect(previewSlug('Kofi & Sons Trading')).toBe('kofi-sons-trading');
    expect(previewSlug('Añejo Peña S.A.')).toBe('anejo-pena-s-a');
  });

  it('folds accents instead of deleting the letter', () => {
    // "caf-d-j-vu" would mangle the name of any company with an accent.
    expect(previewSlug('Café Déjà Vu')).toBe('cafe-deja-vu');
  });

  it('collapses runs and trims stray hyphens', () => {
    expect(previewSlug('  --Weird--Name--  ')).toBe('weird-name');
    expect(previewSlug('A  &  B')).toBe('a-b');
  });

  it('never ends on a hyphen, even after truncation', () => {
    const long = 'Wonderful Extremely Lengthy Company Naming Limited';
    const slug = previewSlug(long);
    expect(slug.length).toBeLessThanOrEqual(36);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('reports names with nothing usable in them', () => {
    expect(isUsableSlug(previewSlug('&&&'))).toBe(false);
    expect(isUsableSlug(previewSlug('  '))).toBe(false);
    expect(isUsableSlug(previewSlug('Ab'))).toBe(false);
    expect(isUsableSlug(previewSlug('Acme'))).toBe(true);
  });
});
