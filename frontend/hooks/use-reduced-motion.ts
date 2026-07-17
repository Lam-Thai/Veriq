"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

let cachedMediaQuery: MediaQueryList | null = null;

function getMediaQuery(): MediaQueryList {
  cachedMediaQuery ??= window.matchMedia(QUERY);
  return cachedMediaQuery;
}

function subscribe(callback: () => void): () => void {
  const mediaQuery = getMediaQuery();
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  return getMediaQuery().matches;
}

function getServerSnapshot(): boolean {
  return false;
}

/** Tracks the user's OS-level prefers-reduced-motion setting, including live changes. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
