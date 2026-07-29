"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { SpinnerIcon, ChevronDownIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { isErrorEnvelope } from "@/lib/error-envelope";
import type { ReportShareDto } from "@/lib/report-shares";

const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

type ShareGroup = "active" | "expired" | "revoked";

function classify(share: ReportShareDto, now: number): ShareGroup {
  if (share.revokedAt !== null) return "revoked";
  if (share.expiresAt.getTime() <= now) return "expired";
  return "active";
}

/** Raw shape of GET /api/report/shares/[id]/views's `data` rows — mirrors the ReportShareView
 * Prisma model's serializable fields (prisma/schema.prisma). `ipHash` is intentionally omitted:
 * it's an opaque, salted digest with no recoverable location and must never be shown or described
 * as one, so it isn't even modeled here. */
type ShareView = {
  id: string;
  viewedAt: string;
  userAgent: string | null;
};

/** Heuristic browser/OS label from a User-Agent string — no new dependency, just substring checks
 * in the order that avoids the obvious false positives (Edge and Chrome both contain "Chrome/";
 * Chrome also contains "Safari/"). */
function describeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = ua.includes("Edg/")
    ? "Edge"
    : ua.includes("Chrome/")
      ? "Chrome"
      : ua.includes("Firefox/")
        ? "Firefox"
        : ua.includes("Safari/")
          ? "Safari"
          : "Unknown browser";
  const os = ua.includes("Windows")
    ? "Windows"
    : ua.includes("iPhone") || ua.includes("iPad") || ua.includes("iOS")
      ? "iOS"
      : ua.includes("Mac OS") || ua.includes("Macintosh")
        ? "Mac"
        : ua.includes("Android")
          ? "Android"
          : ua.includes("Linux")
            ? "Linux"
            : "Unknown OS";
  return `${browser} on ${os}`;
}

type ShareLinksListProps = {
  shares: ReportShareDto[];
  /** Called after a successful revoke so the parent can router.refresh() and re-derive the list
   * from the server — this component never removes/moves a row itself. */
  onRevoked: () => void;
  onAnnounce: (message: string) => void;
};

/**
 * Active/Expired/Revoked grouping for the Sharing tab's link list. Groups are derived client-side
 * from each share's `revokedAt`/`expiresAt` (no separate status column on the DTO — mirrors the
 * comment on lib/report-shares.ts's listSharesForUser). Revoke state (pending-confirm, in-flight,
 * per-row error) is lifted here rather than into each row, mirroring ExpensesPanel's
 * pendingDelete/deletingId/rowError pattern, so rows stay presentational.
 */
export function ShareLinksList({ shares, onRevoked, onAnnounce }: ShareLinksListProps) {
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  if (shares.length === 0) {
    return (
      <Card className="text-center">
        <p className="text-(length:--type-body-size) text-ink-muted-80">No share links yet.</p>
      </Card>
    );
  }

  // `new Date().getTime()`, not `Date.now()` — this repo's react-hooks/purity lint rule flags
  // `Date.now` as a known-impure call reachable from render; `new Date()` isn't flagged (see
  // create-share-dialog.tsx for the same note).
  const now = new Date().getTime();
  const groups: Record<ShareGroup, ReportShareDto[]> = { active: [], expired: [], revoked: [] };
  for (const share of shares) groups[classify(share, now)].push(share);

  async function confirmRevoke(id: string) {
    setRevokingId(id);
    setRowError((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
    try {
      const response = await fetch(`/api/report/shares/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message = isErrorEnvelope(body) ? body.error.message : "Couldn't revoke this share link.";
        setRowError((current) => ({ ...current, [id]: message }));
        onAnnounce(message);
        return;
      }
      setPendingRevoke(null);
      onAnnounce("Share link revoked");
      onRevoked();
    } catch {
      const message = "Couldn't revoke this share link.";
      setRowError((current) => ({ ...current, [id]: message }));
      onAnnounce(message);
    } finally {
      setRevokingId(null);
    }
  }

  const sections: Array<{ group: ShareGroup; label: string }> = [
    { group: "active", label: "Active" },
    { group: "expired", label: "Expired" },
    { group: "revoked", label: "Revoked" },
  ];

  return (
    <div className="flex flex-col gap-6">
      {sections.map(({ group, label }) =>
        groups[group].length > 0 ? (
          <div key={group}>
            <h3 className="text-(length:--type-caption-size) font-semibold text-ink">{label}</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {groups[group].map((share) => (
                <ShareRow
                  key={share.id}
                  share={share}
                  group={group}
                  isPendingRevoke={pendingRevoke === share.id}
                  isRevoking={revokingId === share.id}
                  error={rowError[share.id]}
                  onRequestRevoke={() => setPendingRevoke(share.id)}
                  onCancelRevoke={() => setPendingRevoke(null)}
                  onConfirmRevoke={() => void confirmRevoke(share.id)}
                />
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}

type ShareRowProps = {
  share: ReportShareDto;
  group: ShareGroup;
  isPendingRevoke: boolean;
  isRevoking: boolean;
  error?: string | undefined;
  onRequestRevoke: () => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: () => void;
};

function ShareRow({
  share,
  group,
  isPendingRevoke,
  isRevoking,
  error,
  onRequestRevoke,
  onCancelRevoke,
  onConfirmRevoke,
}: ShareRowProps) {
  const dateLine =
    group === "revoked" && share.revokedAt
      ? `Revoked ${DATE_FMT.format(share.revokedAt)}`
      : group === "expired"
        ? `Expired ${DATE_FMT.format(share.expiresAt)}`
        : `Expires ${DATE_FMT.format(share.expiresAt)}`;
  const viewLine = share.firstViewedAt ? `First viewed ${DATE_FMT.format(share.firstViewedAt)}` : "Not yet viewed";

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-hairline bg-canvas p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-(length:--type-body-size) font-semibold text-ink">Created {DATE_FMT.format(share.createdAt)}</p>
          <p className="mt-0.5 text-(length:--type-fine-print-size) text-ink-muted-48">
            {dateLine} · {viewLine}
          </p>
        </div>

        {group === "active" ? (
          isPendingRevoke ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={onConfirmRevoke}
                disabled={isRevoking}
                aria-busy={isRevoking}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-(length:--type-caption-size) font-semibold text-danger",
                  "transition-colors duration-(--duration-fast) hover:bg-danger-surface",
                  "active:scale-(--press-scale)",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
                  "disabled:pointer-events-none disabled:opacity-70",
                )}
              >
                {isRevoking ? <SpinnerIcon className="h-4 w-4" /> : null}
                {isRevoking ? "Revoking…" : "Confirm"}
              </button>
              <button
                type="button"
                onClick={onCancelRevoke}
                disabled={isRevoking}
                className={cn(
                  "rounded-pill px-3 py-1.5 text-(length:--type-caption-size) font-semibold text-ink-muted-80",
                  "transition-colors duration-(--duration-fast) hover:bg-black/[0.04]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
                  "disabled:pointer-events-none disabled:opacity-70",
                )}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onRequestRevoke}
              // Every row's control reads "Revoke" visually; the created date is what tells them
              // apart for anyone navigating by a screen reader's list of buttons.
              aria-label={`Revoke share link created ${DATE_FMT.format(share.createdAt)}`}
              className={cn(
                "shrink-0 rounded-pill px-3 py-1.5 text-(length:--type-caption-size) font-semibold text-danger",
                "transition-colors duration-(--duration-fast) hover:bg-danger-surface",
                "active:scale-(--press-scale)",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
              )}
            >
              Revoke
            </button>
          )
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-(length:--type-fine-print-size) text-danger">
          {error}
        </p>
      ) : null}

      <ViewLogDisclosure shareId={share.id} createdLabel={DATE_FMT.format(share.createdAt)} />
    </li>
  );
}

type ViewLogStatus = "idle" | "loading" | "error" | "loaded";

/**
 * Lazily-fetched view log, expand-to-reveal. Deliberately not built on components/ui/disclosure.tsx:
 * that primitive keeps its panel mounted at all times (toggled via the `hidden` attribute) so
 * `aria-controls` always resolves, which is exactly wrong here — mounting eagerly would fire the
 * views GET for every row on render instead of only the ones a user actually expands. This local
 * variant mirrors the same trigger/aria-expanded/aria-controls/chevron pattern but only mounts the
 * panel body after the first expand, and fetches at that point.
 */
function ViewLogDisclosure({ shareId, createdLabel }: { shareId: string; createdLabel: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ViewLogStatus>("idle");
  const [views, setViews] = useState<ShareView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const panelId = `share-views-${shareId}`;

  async function loadViews() {
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch(`/api/report/shares/${shareId}/views`);
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(isErrorEnvelope(body) ? body.error.message : "Couldn't load the view log.");
      }
      const envelope = body as { data: ShareView[] };
      setViews(envelope.data);
      setStatus("loaded");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the view log.");
      setStatus("error");
    }
  }

  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next && status === "idle") void loadViews();
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        aria-controls={panelId}
        // Same reason as the Revoke button above: "View log" repeats once per row, so the created
        // date is what disambiguates them in a screen reader's controls list.
        aria-label={`View log for share link created ${createdLabel}`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-sm text-(length:--type-fine-print-size) font-medium text-ink-muted-80",
          "transition-[color,transform] duration-(--duration-fast) ease-(--ease-out)",
          "hover:text-ink active:scale-(--press-scale)",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
          "motion-reduce:transition-none",
        )}
      >
        View log
        <ChevronDownIcon
          className={cn(
            "h-4 w-4 transition-transform duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div id={panelId} className="mt-2 text-(length:--type-fine-print-size) text-ink-muted-80">
          {status === "loading" ? (
            <p className="flex items-center gap-1.5">
              <SpinnerIcon className="h-3.5 w-3.5" /> Loading view log…
            </p>
          ) : status === "error" ? (
            <p role="alert" className="text-danger">
              {error}{" "}
              <button type="button" onClick={() => void loadViews()} className="font-semibold underline">
                Try again
              </button>
            </p>
          ) : views.length === 0 ? (
            <p>No views yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {views.map((view) => (
                <li key={view.id}>
                  {DATE_FMT.format(new Date(view.viewedAt))} · {describeUserAgent(view.userAgent)}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
