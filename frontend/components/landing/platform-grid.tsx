"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { CheckIcon, SpinnerIcon } from "@/components/ui/icons";
import { PlatformAvatar } from "@/components/landing/platform-avatar";
import {
  findPlatformBySlug,
  getAuthorizationUrl,
  PLATFORMS,
  type Platform,
  type PlatformStatus,
} from "@/components/landing/platform-data";
import {
  CONNECT_RESULT_PARAM,
  CONNECT_SLUG_PARAM,
  isConnectResultMessage,
  type ConnectResult,
} from "@/lib/connect-flow";

const POPUP_POLL_INTERVAL_MS = 500;

function resultToStatus(result: ConnectResult): PlatformStatus {
  return result === "approved" ? "connected" : "available";
}

function announcementFor(slug: string, result: ConnectResult): string {
  const name = findPlatformBySlug(slug)?.name ?? slug;
  return result === "approved" ? `${name} connected` : `${name} connection canceled`;
}

type UrlConnectResult = { slug: string; result: ConnectResult } | null;

// Genuinely external state (the URL), read through useSyncExternalStore rather than copied into
// React state — this is what lets the initial render match the server (which never sees query
// params) without a hydration mismatch, and avoids re-deriving a stale value after the query
// string below is stripped: once resolved for this page load, the result is cached here.
let cachedUrlConnectResult: UrlConnectResult | undefined;

function subscribeToUrlConnectResult() {
  // The value only matters once, right after mount — nothing external re-triggers it.
  return () => {};
}

function getUrlConnectResultSnapshot(): UrlConnectResult {
  if (cachedUrlConnectResult !== undefined) return cachedUrlConnectResult;

  const params = new URLSearchParams(window.location.search);
  const result = params.get(CONNECT_RESULT_PARAM);
  const slug = params.get(CONNECT_SLUG_PARAM);
  cachedUrlConnectResult =
    (result === "approved" || result === "denied") && slug && findPlatformBySlug(slug)
      ? { slug, result }
      : null;
  return cachedUrlConnectResult;
}

function getUrlConnectResultServerSnapshot(): UrlConnectResult {
  return null;
}

type PendingAttempt = {
  state: string;
  popup: Window | null;
};

/**
 * Owns the connect/connected state for the platform grid. A click opens the platform's login
 * flow in a popup (same-tab fallback if popups are blocked); "Connected" is only ever set from
 * the outcome of that flow — via a validated postMessage from the popup, or, on the no-popup
 * path, a one-time query param the server only attaches after verifying the flow succeeded.
 */
export function PlatformGrid() {
  const [statuses, setStatuses] = useState<Record<string, PlatformStatus>>(() =>
    Object.fromEntries(PLATFORMS.map((platform) => [platform.slug, platform.status])),
  );
  const [announcement, setAnnouncement] = useState("");
  const [fallbackAuthorizationUrl, setFallbackAuthorizationUrl] = useState<string | null>(null);
  // Tracks which urlConnectResult (by reference — see cachedUrlConnectResult) has already been
  // folded into `statuses`, so the fold below runs exactly once and `statuses` stays the single
  // source of truth afterward instead of being permanently re-masked by a stale URL value.
  const [reconciledUrlResult, setReconciledUrlResult] = useState<UrlConnectResult>(null);

  const pendingAttempts = useRef<Record<string, PendingAttempt>>({});
  const pollIntervals = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const inFlightSlugs = useRef<Set<string>>(new Set());

  // No-popup fallback: the callback route only ever appends this param after it has verified
  // the flow's CSRF state against its HttpOnly cookie, so it's safe to trust directly here.
  const urlConnectResult = useSyncExternalStore(
    subscribeToUrlConnectResult,
    getUrlConnectResultSnapshot,
    getUrlConnectResultServerSnapshot,
  );

  // React's documented "adjusting state during render" pattern: fold the one-time URL result
  // into `statuses` the first time it appears, comparing by reference so this only ever fires
  // once per result. No effect involved, so there's no window where a later, legitimate update
  // to the same slug (from a message or the poll timeout) could be overwritten by a re-applied
  // stale value.
  if (urlConnectResult && urlConnectResult !== reconciledUrlResult) {
    setReconciledUrlResult(urlConnectResult);
    setStatuses((current) => ({
      ...current,
      [urlConnectResult.slug]: resultToStatus(urlConnectResult.result),
    }));
  }

  // Housekeeping only (no React state involved) — strip the one-time result params so a refresh
  // doesn't re-read them, now that `cachedUrlConnectResult` above has already latched the value.
  useEffect(() => {
    if (!urlConnectResult) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has(CONNECT_RESULT_PARAM) && !params.has(CONNECT_SLUG_PARAM)) return;
    params.delete(CONNECT_RESULT_PARAM);
    params.delete(CONNECT_SLUG_PARAM);
    const search = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
    );
  }, [urlConnectResult]);

  // Same-tab fallback navigation lives in an effect rather than the click handler so the actual
  // window.location mutation happens as a proper side effect, not inline in render-adjacent code.
  useEffect(() => {
    if (fallbackAuthorizationUrl) {
      window.location.href = fallbackAuthorizationUrl;
    }
  }, [fallbackAuthorizationUrl]);

  useEffect(() => {
    const intervals = pollIntervals.current;

    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (!isConnectResultMessage(event.data)) return;

      const attempt = pendingAttempts.current[event.data.slug];
      // Guards against stale/duplicate/forged messages: only a message whose state matches the
      // attempt this window actually started for that slug is trusted.
      if (!attempt || attempt.state !== event.data.state) return;

      const interval = intervals[event.data.slug];
      if (interval !== undefined) {
        clearInterval(interval);
        delete intervals[event.data.slug];
      }
      delete pendingAttempts.current[event.data.slug];

      setStatuses((current) => ({ ...current, [event.data.slug]: resultToStatus(event.data.result) }));
      setAnnouncement(announcementFor(event.data.slug, event.data.result));
    }

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      for (const interval of Object.values(intervals)) {
        clearInterval(interval);
      }
    };
  }, []);

  const connectedCount = Object.values(statuses).filter((status) => status === "connected").length;
  const connectedTotal = PLATFORMS.filter(
    (platform) => statuses[platform.slug] === "connected",
  ).reduce((sum, platform) => sum + platform.verifiedAmount, 0);

  function handleConnect(slug: string) {
    const existing = pendingAttempts.current[slug];
    if (existing && !existing.popup?.closed) {
      existing.popup?.focus();
      return;
    }
    // Synchronous re-entrancy guard: claims the slug before any work below (including
    // window.open) runs, so a second invocation for the same slug — e.g. a repeated click before
    // React has committed the disabled button state — sees the claim and returns immediately,
    // rather than racing to start a second attempt before `pendingAttempts` is populated.
    if (inFlightSlugs.current.has(slug)) return;
    inFlightSlugs.current.add(slug);

    const state = crypto.randomUUID();
    const authorizationUrl = getAuthorizationUrl(slug, state);

    setStatuses((current) => ({ ...current, [slug]: "connecting" }));

    const popup = window.open(
      authorizationUrl,
      `veriq-connect-${slug}`,
      "width=480,height=640,popup=1",
    );
    inFlightSlugs.current.delete(slug);

    if (!popup || popup.closed) {
      // Popup blocked — fall back to a full same-tab navigation through the same authorize URL.
      setFallbackAuthorizationUrl(authorizationUrl);
      return;
    }

    pendingAttempts.current[slug] = { state, popup };
    pollIntervals.current[slug] = setInterval(() => {
      const attempt = pendingAttempts.current[slug];
      if (!attempt) return;
      if (attempt.popup?.closed) {
        clearInterval(pollIntervals.current[slug]);
        delete pollIntervals.current[slug];
        delete pendingAttempts.current[slug];
        // Only reset if still "connecting" — a message may have already resolved it.
        setStatuses((current) =>
          current[slug] === "connecting" ? { ...current, [slug]: "available" } : current,
        );
      }
    }, POPUP_POLL_INTERVAL_MS);
  }

  return (
    <div>
      <p aria-live="polite" className="text-center text-(length:--type-caption-size) text-ink-muted-48">
        {connectedCount} of {PLATFORMS.length} connected · ${connectedTotal.toLocaleString()}{" "}
        verified
      </p>
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PLATFORMS.map((platform) => (
          <PlatformCard
            key={platform.slug}
            platform={platform}
            status={statuses[platform.slug] ?? platform.status}
            onConnect={() => handleConnect(platform.slug)}
          />
        ))}
      </ul>
    </div>
  );
}

type PlatformCardProps = {
  platform: Platform;
  status: PlatformStatus;
  onConnect: () => void;
};

function PlatformCard({ platform, status, onConnect }: PlatformCardProps) {
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <li className="flex items-center gap-4 rounded-lg border border-hairline bg-canvas p-4">
      <PlatformAvatar platform={platform} />

      <div className="min-w-0 flex-1">
        <p className="text-(length:--type-body-size) font-semibold text-ink">{platform.name}</p>
        <p className="text-(length:--type-caption-size) text-ink-muted-48">{platform.category}</p>
      </div>

      {isConnected ? (
        <span className="flex shrink-0 items-center gap-1.5 text-(length:--type-caption-size) font-semibold text-verified">
          <CheckIcon className="h-4 w-4" />
          Connected
        </span>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          disabled={isConnecting}
          aria-busy={isConnecting}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-pill px-3 py-1.5 text-(length:--type-caption-size) font-semibold text-primary",
            "transition-colors duration-(--duration-fast) hover:bg-primary/10",
            "active:scale-(--press-scale)",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
            "disabled:pointer-events-none disabled:opacity-70",
          )}
        >
          {isConnecting ? <SpinnerIcon className="h-4 w-4" /> : null}
          {isConnecting ? "Connecting…" : "Connect"}
        </button>
      )}
    </li>
  );
}
