"use client";

import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

/**
 * Light/dark mode toggle — a single icon button that flips the app.
 *
 * BOTH icons are rendered; CSS (keyed on `html[data-mode]`, set before
 * first paint by the boot script) shows the one matching the current
 * mode. This avoids branching on the JS `mode` value, which is unknown
 * during SSR and would otherwise flip the icon after hydration (a
 * visible flash on reload). The click still toggles via the provider.
 *
 * 40×40 hit target to match the header's other touch controls.
 */
export function ModeToggle({ className }: { className?: string }) {
  const { toggleMode } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleMode}
      aria-label="Switch between light and dark mode"
      title="Switch light / dark mode"
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <Moon className="mode-icon-dark h-5 w-5" />
      <Sun className="mode-icon-light h-5 w-5" />
    </button>
  );
}
