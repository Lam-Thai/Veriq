"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { CheckIcon, CloseIcon, SpinnerIcon } from "@/components/ui/icons";
import { PlatformAvatar } from "@/components/landing/platform-avatar";
import {
  findPlatformBySlug,
  getAuthorizationUrl,
  PLATFORMS,
  type Platform,
  type PlatformStatus,
} from "@/components/landing/platform-data";
import { isConnectResultMessage, type ConnectResult } from "@/lib/connect-flow";
import { isErrorEnvelope } from "@/lib/error-envelope";
import type { UserConnection } from "@/lib/dashboard-data";

const POPUP_POLL_INTERVAL_MS = 500;

function resultToStatus(result: ConnectResult): PlatformStatus {
  return result === "approved" ? "connected" : "available";
}

function announcementFor(slug: string, result: ConnectResult): string {
  const name = findPlatformBySlug(slug)?.name ?? slug;
  return result === "approved" ? `${name} connected` : `${name} connection canceled`;
}

type PendingAttempt = {
  state: string;
  popup: Window | null;
};

type ConnectionsPanelProps = {
  /** Slugs the signed-in user has already connected, server-fetched from PlatformConnection —
   * the real source of truth, unlike the landing page's static PLATFORMS[].status snapshot. */
  initialConnectedSlugs: string[];
  /** Per-connection verifiedAmount, used to compute each connected card's contribution
   * percentage of the user's total verified income. */
  connections: UserConnection[];
  totalVerified: number;
  /** null = unlimited (Pro/Enterprise). See lib/plan-limits.ts. */
  maxPlatforms: number | null;
};

/**
 * Dashboard-authenticated counterpart to components/landing/platform-grid.tsx. Same popup/
 * same-tab-fallback connect orchestration, but seeded from real per-user data and with no
 * URL-param reconciliation — every connect attempt here runs behind Clerk auth (proxy.ts), and
 * the callback route persists the result server-side before either completion path fires, so
 * there is no client-only state that needs recovering from the URL. The real platform-cap
 * enforcement lives server-side in app/connect/[slug]/callback/route.ts — `maxPlatforms` here is
 * only a UX hint to avoid a doomed popup round-trip once already at the limit.
 */
export function ConnectionsPanel({
  initialConnectedSlugs,
  connections,
  totalVerified,
  maxPlatforms,
}: ConnectionsPanelProps) {
  const router = useRouter();
  const connectedSet = new Set(initialConnectedSlugs);
  const amountBySlug = new Map(connections.map((connection) => [connection.slug, connection.verifiedAmount]));

  const [statuses, setStatuses] = useState<Record<string, PlatformStatus>>(() =>
    Object.fromEntries(PLATFORMS.map((platform) => [platform.slug, connectedSet.has(platform.slug) ? "connected" : "available"])),
  );
  const [announcement, setAnnouncement] = useState("");
  const [fallbackAuthorizationUrl, setFallbackAuthorizationUrl] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});

  const pendingAttempts = useRef<Record<string, PendingAttempt>>({});
  const pollIntervals = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const inFlightSlugs = useRef<Set<string>>(new Set());

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
      // The message reflects a real completed server-side write, but stat tiles / the monthly
      // chart on this page were computed server-side at the last render — refresh so they resync
      // from persisted data instead of only trusting the client-asserted message payload.
      router.refresh();
    }

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      for (const interval of Object.values(intervals)) {
        clearInterval(interval);
      }
    };
  }, [router]);

  const connectedCount = Object.values(statuses).filter((status) => status === "connected").length;
  const isAtCap = maxPlatforms !== null && connectedCount >= maxPlatforms;

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

    const popup = window.open(authorizationUrl, `veriq-connect-${slug}`, "width=480,height=640,popup=1");
    inFlightSlugs.current.delete(slug);

    if (!popup || popup.closed) {
      // Popup blocked — fall back to a full same-tab navigation through the same authorize URL.
      setFallbackAuthorizationUrl(authorizationUrl);
      return;
    }

    // A previous attempt for this slug may have closed its popup without the poll below having
    // fired yet — clear its interval before overwriting the ref, otherwise the stale interval
    // keeps running and can end up clearing *this* new interval by id instead of itself.
    const staleInterval = pollIntervals.current[slug];
    if (staleInterval !== undefined) {
      clearInterval(staleInterval);
      delete pollIntervals.current[slug];
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
        setStatuses((current) => (current[slug] === "connecting" ? { ...current, [slug]: "available" } : current));
      }
    }, POPUP_POLL_INTERVAL_MS);
  }

  function handleRemoveClick(slug: string) {
    setPendingRemoval((current) => new Set(current).add(slug));
  }

  function handleCancelRemove(slug: string) {
    setPendingRemoval((current) => {
      const next = new Set(current);
      next.delete(slug);
      return next;
    });
  }

  async function handleConfirmRemove(slug: string) {
    setRemoving((current) => new Set(current).add(slug));
    setRemoveErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== slug)));

    try {
      const response = await fetch(`/api/connections/${slug}`, { method: "DELETE" });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message = isErrorEnvelope(body) ? body.error.message : "Couldn't remove this platform.";
        setRemoveErrors((current) => ({ ...current, [slug]: message }));
        return;
      }

      setStatuses((current) => ({ ...current, [slug]: "available" }));
      setPendingRemoval((current) => {
        const next = new Set(current);
        next.delete(slug);
        return next;
      });
      setAnnouncement(`${findPlatformBySlug(slug)?.name ?? slug} removed`);
      // Same rationale as the connect success path above — resync stats/contribution
      // percentages from the server instead of only updating local UI state.
      router.refresh();
    } catch {
      setRemoveErrors((current) => ({ ...current, [slug]: "Couldn't remove this platform." }));
    } finally {
      setRemoving((current) => {
        const next = new Set(current);
        next.delete(slug);
        return next;
      });
    }
  }

  return (
    <div>
      <p aria-live="polite" className="text-(length:--type-caption-size) text-ink-muted-48">
        {connectedCount} of {PLATFORMS.length} connected
      </p>
      {isAtCap ? (
        <p className="mt-1 text-(length:--type-caption-size) text-ink-muted-80">
          You&rsquo;ve reached your plan&rsquo;s limit of {maxPlatforms} connected platform{maxPlatforms === 1 ? "" : "s"}.
          Remove one or upgrade your plan to connect more.
        </p>
      ) : null}
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {PLATFORMS.map((platform) => {
          const amount = amountBySlug.get(platform.slug) ?? 0;
          const contributionPct = totalVerified > 0 ? Math.round((amount / totalVerified) * 100) : 0;
          return (
            <PlatformCard
              key={platform.slug}
              platform={platform}
              status={statuses[platform.slug] ?? platform.status}
              contributionPct={contributionPct}
              disabledForCap={isAtCap}
              isPendingRemoval={pendingRemoval.has(platform.slug)}
              isRemoving={removing.has(platform.slug)}
              removeError={removeErrors[platform.slug]}
              onConnect={() => handleConnect(platform.slug)}
              onRemoveClick={() => handleRemoveClick(platform.slug)}
              onCancelRemove={() => handleCancelRemove(platform.slug)}
              onConfirmRemove={() => void handleConfirmRemove(platform.slug)}
            />
          );
        })}
      </ul>
    </div>
  );
}

type PlatformCardProps = {
  platform: Platform;
  status: PlatformStatus;
  contributionPct: number;
  disabledForCap: boolean;
  isPendingRemoval: boolean;
  isRemoving: boolean;
  removeError?: string | undefined;
  onConnect: () => void;
  onRemoveClick: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
};

function PlatformCard({
  platform,
  status,
  contributionPct,
  disabledForCap,
  isPendingRemoval,
  isRemoving,
  removeError,
  onConnect,
  onRemoveClick,
  onCancelRemove,
  onConfirmRemove,
}: PlatformCardProps) {
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-hairline bg-canvas p-4">
      <div className="flex items-center gap-4">
        <PlatformAvatar platform={platform} />

        <div className="min-w-0 flex-1">
          <p className="text-(length:--type-body-size) font-semibold text-ink">{platform.name}</p>
          <p className="text-(length:--type-caption-size) text-ink-muted-48">{platform.category}</p>
          {isConnected ? (
            <p className="mt-0.5 text-(length:--type-fine-print-size) text-ink-muted-48">
              {contributionPct}% of your verified income
            </p>
          ) : null}
        </div>

        {isConnected ? (
          isPendingRemoval ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={onConfirmRemove}
                disabled={isRemoving}
                aria-busy={isRemoving}
                className={cn(
                  "rounded-pill px-3 py-1.5 text-(length:--type-caption-size) font-semibold text-danger",
                  "hover:bg-danger-surface transition-colors duration-(--duration-fast)",
                  "active:scale-(--press-scale)",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
                  "disabled:pointer-events-none disabled:opacity-70",
                )}
              >
                {isRemoving ? "Removing…" : "Confirm remove"}
              </button>
              <button
                type="button"
                onClick={onCancelRemove}
                disabled={isRemoving}
                className={cn(
                  "rounded-pill px-3 py-1.5 text-(length:--type-caption-size) font-semibold text-ink-muted-80",
                  "hover:bg-black/[0.04] transition-colors duration-(--duration-fast)",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
                  "disabled:pointer-events-none disabled:opacity-70",
                )}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-3">
              <span className="flex items-center gap-1.5 text-(length:--type-caption-size) font-semibold text-verified">
                <CheckIcon className="h-4 w-4" />
                Connected
              </span>
              <button
                type="button"
                onClick={onRemoveClick}
                aria-label={`Remove ${platform.name}`}
                className={cn(
                  "rounded-full p-1.5 text-ink-muted-48",
                  "hover:bg-danger-surface hover:text-danger transition-colors duration-(--duration-fast)",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
                )}
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          )
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={isConnecting || disabledForCap}
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
      </div>

      {removeError ? (
        <p role="alert" className="text-(length:--type-fine-print-size) text-danger">
          {removeError}
        </p>
      ) : null}
    </li>
  );
}
