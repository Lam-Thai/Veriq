/**
 * Shared constants for the light/dark toggle (components/ui/theme-toggle.tsx) and the
 * FOUC-avoiding inline init script rendered in app/layout.tsx. No `server-only` marker — both
 * consumers are client-side (the init script runs in the browser before hydration, the toggle is
 * a "use client" component), and this file has zero imports of its own.
 *
 * Only ever stores an *explicit* user override. No stored value means "follow the OS", which
 * app/globals.css's `@media (prefers-color-scheme: dark)` block already handles with zero JS —
 * the init script below only has work to do when localStorage holds an explicit choice.
 */
export const THEME_STORAGE_KEY = "veriq-theme";

export type Theme = "light" | "dark";

// Dispatched whenever this tab changes the theme, so components subscribed via
// subscribeToThemeChanges (see components/ui/theme-toggle.tsx's useSyncExternalStore) re-read it
// — the "storage" event alone only fires in *other* tabs, never the one that made the change.
const THEME_CHANGE_EVENT = "veriq-theme-change";

/**
 * Sets `data-theme` on `<html>` and persists the choice. Exported so the toggle component and any
 * future settings UI share one place that writes both the DOM and localStorage — never one
 * without the other, which would desync what's on screen from what survives a reload.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

/** `useSyncExternalStore` subscribe function for components that need to re-render when the
 * theme changes — same-tab (THEME_CHANGE_EVENT), cross-tab ("storage", which only fires in
 * *other* tabs than the one that wrote the change), and a live OS scheme flip (only actually
 * changes `getEffectiveTheme`'s result while no explicit override is stored, but the toggle icon
 * should still track it rather than only catching up on next unrelated re-render). */
export function subscribeToThemeChanges(callback: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  media.addEventListener("change", callback);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
    media.removeEventListener("change", callback);
  };
}

/** The theme actually painted right now — the stored override if one exists and is valid,
 * otherwise whatever the OS reports. Used by the toggle to know which way to flip on click.
 * Wrapped in try/catch for the same reason THEME_INIT_SCRIPT below is: `localStorage`/
 * `matchMedia` can throw in some browsers/privacy modes, and unlike the init script this runs on
 * every render (as `useSyncExternalStore`'s `getSnapshot`), so an uncaught throw here would take
 * down the whole page, not just skip an early theme correction. */
export function getEffectiveTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/**
 * Inlined verbatim into app/layout.tsx via `dangerouslySetInnerHTML` as the first thing rendered
 * in `<html>`, so it runs synchronously before first paint — reading `--color-*` custom
 * properties from a `<html data-theme>` attribute that isn't there yet would flash the wrong
 * theme for a frame. Only sets the attribute when there's a *stored* override; the no-preference
 * default is left to the CSS media query so most visitors need no JS for correct-on-first-paint
 * theming at all. Wrapped in try/catch since `localStorage` can throw in some browsers/privacy
 * modes (e.g. Safari private browsing) — a failure here must never block rendering the page.
 */
export const THEME_INIT_SCRIPT = `
try {
  var t = localStorage.getItem("${THEME_STORAGE_KEY}");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch (e) {}
`;
