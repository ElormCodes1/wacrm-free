import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { PasswordInput } from './password-input';

/**
 * Static-markup tests, not DOM ones.
 *
 * This project has no jsdom and no Testing Library, and an eye icon does
 * not justify pulling in three dependencies to click it. What it does
 * justify is pinning the invariants that hold at first render — which
 * happen to include the one that actually breaks things.
 *
 * The toggle itself (masked ↔ visible) is state, so it is not covered
 * here. It is one useState and visible the moment anyone opens the sign-in
 * page; the submit bug below is neither.
 */
describe('PasswordInput', () => {
  const html = (ui: React.ReactElement) => renderToStaticMarkup(ui);

  it('renders masked', () => {
    expect(html(<PasswordInput id="p" defaultValue="hunter2" />)).toContain(
      'type="password"',
    );
  });

  /**
   * The one that matters. A bare <button> inside a <form> defaults to
   * type="submit", so without this the eye icon submits the sign-in form
   * with a half-typed password — precisely when someone reaches for it
   * because they are unsure what they have typed.
   */
  it('gives the toggle type="button" so it cannot submit the form', () => {
    expect(html(<PasswordInput id="p" />)).toContain('type="button"');
  });

  it('keeps the toggle out of the tab order between password and submit', () => {
    expect(html(<PasswordInput id="p" />)).toContain('tabindex="-1"');
  });

  it('names the field, so two toggles on signup are distinguishable', () => {
    expect(html(<PasswordInput id="a" />)).toContain('aria-label="Show password"');
    expect(html(<PasswordInput id="b" fieldLabel="confirm password" />)).toContain(
      'aria-label="Show confirm password"',
    );
  });

  it('leaves room for the button so a long value cannot run under it', () => {
    expect(html(<PasswordInput id="p" />)).toContain('pr-10');
  });
});
