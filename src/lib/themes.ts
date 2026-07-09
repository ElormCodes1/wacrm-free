/**
 * Theme catalog — two axes:
 *
 *  • PREFERENCE — what the user picks: "system" | "light" | "dark".
 *    "system" follows the OS (prefers-color-scheme). This is what we
 *    persist to localStorage and default to.
 *  • MODE — the RESOLVED look actually applied to the page:
 *    "light" | "dark". When the preference is "system" the mode is
 *    computed from the OS; otherwise it equals the preference.
 *
 * The app adopts WhatsApp Web's visual identity as its single canonical
 * look, so there is no accent picker — the WhatsApp teal accent is
 * pinned in `src/app/globals.css` under `:root`. The only user-switchable
 * dimension is this light/dark mode. CSS variables live in globals.css
 * under `html[data-mode="..."]`; the mode is applied at runtime via
 * `document.documentElement.dataset.mode`.
 */

export const MODES = ["light", "dark"] as const;

export type Mode = (typeof MODES)[number];

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;

export type Preference = (typeof THEME_PREFERENCES)[number];

/** Default preference: follow the operating system. */
export const DEFAULT_PREFERENCE: Preference = "system";

/**
 * Resolved-mode fallback for when the OS preference can't be read
 * (server render, or a browser without matchMedia). WhatsApp's signature
 * look is the near-black dark theme, so we fall back to dark.
 */
export const DEFAULT_MODE: Mode = "dark";

/**
 * localStorage key. Stores a PREFERENCE ("system" | "light" | "dark").
 * Legacy values were "light" | "dark" (still valid preferences), so
 * existing choices carry over; a missing value means "system".
 */
export const MODE_STORAGE_KEY = "wacrm.mode";

export function isMode(value: unknown): value is Mode {
  return (
    typeof value === "string" && (MODES as ReadonlyArray<string>).includes(value)
  );
}

export function isPreference(value: unknown): value is Preference {
  return (
    typeof value === "string" &&
    (THEME_PREFERENCES as ReadonlyArray<string>).includes(value)
  );
}
