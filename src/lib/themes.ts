/**
 * Theme catalog — light/dark MODE only.
 *
 * The app adopts WhatsApp Web's visual identity as its single
 * canonical look, so there is no accent picker: the WhatsApp teal
 * accent is pinned in `src/app/globals.css` under `:root`. The only
 * user-switchable dimension is MODE (light / dark).
 *
 * The CSS variables live in `src/app/globals.css` under
 * `html[data-mode="..."]` blocks (neutral surfaces). Applied at
 * runtime via `document.documentElement.dataset.mode`. Dark is the
 * default and carries WhatsApp's signature near-black chat; light is
 * the classic beige-wallpaper alternative.
 */

export const MODES = ["light", "dark"] as const;

export type Mode = (typeof MODES)[number];

export const DEFAULT_MODE: Mode = "dark";

export const MODE_STORAGE_KEY = "wacrm.mode";

export function isMode(value: unknown): value is Mode {
  return (
    typeof value === "string" && (MODES as ReadonlyArray<string>).includes(value)
  );
}
