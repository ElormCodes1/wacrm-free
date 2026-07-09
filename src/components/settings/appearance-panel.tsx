"use client";

import { Check, Monitor, Moon, SunMoon, Sun, type LucideIcon } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import { THEME_PREFERENCES, type Preference } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Appearance panel — theme preference (System / Light / Dark).
 *
 * "System" follows the OS and updates live if the OS flips. The app's
 * accent is fixed to WhatsApp teal, so mode is the only control. Choices
 * apply + persist immediately (a single attribute swap on <html>) and
 * the boot script in layout.tsx replays them before first paint.
 *
 * Persistence: localStorage only (device-scoped).
 */

const OPTION: Record<Preference, { label: string; hint: string; Icon: LucideIcon }> = {
  system: { label: "System", hint: "Match your device", Icon: Monitor },
  light: { label: "Light", hint: "Always light", Icon: Sun },
  dark: { label: "Dark", hint: "Always dark", Icon: Moon },
};

export function AppearancePanel() {
  const { preference, setPreference } = useTheme();
  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Appearance"
        description="Follow your device or force light/dark. Saved to this device — it changes live."
      />

      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <SunMoon className="size-4 text-muted-foreground" />
          Theme
        </h3>

        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-3"
        >
          {THEME_PREFERENCES.map((p) => (
            <ThemeCard
              key={p}
              preference={p}
              isActive={p === preference}
              onPick={() => setPreference(p)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ThemeCard({
  preference,
  isActive,
  onPick,
}: {
  preference: Preference;
  isActive: boolean;
  onPick: () => void;
}) {
  const { label, hint, Icon } = OPTION[preference];
  return (
    <button
      type="button"
      role="radio"
      onClick={onPick}
      aria-checked={isActive}
      aria-label={`Use ${label.toLowerCase()} theme`}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors",
        isActive
          ? "border-primary/60 ring-2 ring-primary/40"
          : "border-border hover:bg-muted/40",
      )}
    >
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {label}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {hint}
        </span>
      </span>
      {isActive && (
        <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      )}
    </button>
  );
}
