"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_MODE,
  DEFAULT_PREFERENCE,
  MODE_STORAGE_KEY,
  isPreference,
  type Mode,
  type Preference,
} from "@/lib/themes";

/**
 * ThemeProvider — owns the app's single theming axis: light/dark.
 *
 * Two values:
 *  • `preference` — the user's choice: system / light / dark (persisted).
 *  • `mode` — the RESOLVED look applied to the page (light / dark),
 *    reflected as `data-mode` on <html>. When preference is "system" it
 *    tracks the OS and updates live if the OS flips.
 *
 * The boot script in `src/app/layout.tsx` applies `data-mode` before
 * React hydrates, so the page paints correctly from the first frame.
 * Crucially, <html> does NOT carry `data-mode` as a JSX prop — otherwise
 * React would reconcile it back to a literal on client navigations and
 * wipe the user's choice (the "reverts to dark on navigate" bug). We own
 * the attribute imperatively and re-assert it in an effect.
 *
 * Persistence is localStorage only (device-scoped) — your phone may
 * deserve a different mode than your laptop.
 */

interface ThemeContextValue {
  /** Resolved light/dark actually on screen. */
  mode: Mode;
  /** The user's stored choice (system / light / dark). */
  preference: Preference;
  /** Set an explicit light/dark (shortcut used by the header toggle). */
  setMode: (next: Mode) => void;
  /** Set the full preference including "system". */
  setPreference: (next: Preference) => void;
  /** Flip between light and dark (sets an explicit preference). */
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemMode(): Mode {
  if (typeof window === "undefined" || !window.matchMedia) return DEFAULT_MODE;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolve(pref: Preference): Mode {
  return pref === "system" ? systemMode() : pref;
}

function readInitialPreference(): Preference {
  if (typeof window === "undefined") return DEFAULT_PREFERENCE;
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (isPreference(stored)) return stored;
  } catch {
    // localStorage can throw in private-browsing / sandboxed contexts.
  }
  return DEFAULT_PREFERENCE;
}

function applyMode(mode: Mode) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.mode = mode;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPrefState] = useState<Preference>(readInitialPreference);
  const [mode, setModeResolved] = useState<Mode>(() =>
    resolve(readInitialPreference()),
  );

  const setPreference = useCallback((next: Preference) => {
    setPrefState(next);
    const resolved = resolve(next);
    setModeResolved(resolved);
    applyMode(resolved);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // Private-browsing edge case; in-memory state still updates so the
      // current tab works for the session.
    }
  }, []);

  // Header toggle picks an explicit light/dark (not "system").
  const setMode = useCallback(
    (next: Mode) => setPreference(next),
    [setPreference],
  );

  const toggleMode = useCallback(() => {
    setPreference(mode === "dark" ? "light" : "dark");
  }, [mode, setPreference]);

  // Re-assert data-mode on mount and whenever the resolved mode changes.
  // This heals any reset of the attribute (e.g. an <html> reconciliation
  // on client navigation) so the chosen mode survives page changes.
  useEffect(() => {
    applyMode(mode);
  }, [mode]);

  // While following the OS, react live to the OS flipping light/dark.
  useEffect(() => {
    if (preference !== "system" || typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next: Mode = mq.matches ? "dark" : "light";
      setModeResolved(next);
      applyMode(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  // Sync from other tabs — change the preference in tab A, tab B catches
  // up without a refresh.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === MODE_STORAGE_KEY && isPreference(e.newValue)) {
        setPrefState(e.newValue);
        const resolved = resolve(e.newValue);
        setModeResolved(resolved);
        applyMode(resolved);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <ThemeContext.Provider
      value={{ mode, preference, setMode, setPreference, toggleMode }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider — no-op
    // setters so callers don't crash. The boot script already applied
    // the right CSS attributes, so visually the page is fine.
    return {
      mode: DEFAULT_MODE,
      preference: DEFAULT_PREFERENCE,
      setMode: () => {},
      setPreference: () => {},
      toggleMode: () => {},
    };
  }
  return ctx;
}
