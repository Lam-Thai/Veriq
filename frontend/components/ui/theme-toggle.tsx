"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { SunIcon, MoonIcon } from "@/components/ui/icons";
import { applyTheme, getEffectiveTheme, subscribeToThemeChanges, type Theme } from "@/lib/theme";

function getServerSnapshot(): Theme | null {
  return null;
}

/**
 * Icon-only light/dark toggle for the black nav bars (components/landing/nav.tsx,
 * components/dashboard/dashboard-header.tsx) — styled to match those bars' existing
 * white/70 → white nav-item treatment, not the general-purpose icon-button pattern used
 * elsewhere (e.g. connections-panel.tsx's remove button), since it only ever sits on that one
 * background. `useSyncExternalStore` (rather than state + an effect) reads the real theme once
 * mounted: the current theme is unknowable server-side (it depends on localStorage / OS
 * preference, both client-only), so `getServerSnapshot` returns null and this renders a neutral
 * icon for that one frame — same trade-off `lib/theme.ts`'s THEME_INIT_SCRIPT accepts for the
 * page background, just for a single small icon instead of the whole page.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToThemeChanges, getEffectiveTheme, getServerSnapshot);
  const isDark = theme === "dark";

  function toggle() {
    applyTheme((theme ?? getEffectiveTheme()) === "dark" ? "light" : "dark");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "rounded-full p-1.5 text-white/70",
        "transition-colors duration-(--duration-fast) hover:bg-white/10 hover:text-white",
        "active:scale-(--press-scale)",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
      )}
    >
      {isDark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
    </button>
  );
}
