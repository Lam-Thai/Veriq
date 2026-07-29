"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PillButton } from "@/components/ui/pill-button";
import { LinkIcon } from "@/components/ui/icons";
import { CreateShareDialog } from "@/components/dashboard/create-share-dialog";
import { ShareLinksList } from "@/components/dashboard/share-links-list";
import type { ReportShareDto } from "@/lib/report-shares";

type SharingPanelProps = {
  /** Most recent READY report job, or null if the user has never generated one — new share links
   * always point at this one. */
  latestReadyReportJobId: string | null;
  initialShares: ReportShareDto[];
  /** Mirrors lib/report-shares.ts's MAX_ACTIVE_SHARES_PER_REPORT / MAX_SHARE_EXPIRY_DAYS, passed
   * down from the server component (app/dashboard/page.tsx) since that module is `import
   * "server-only"` and can't be imported directly from a client component — this keeps both limits
   * as a single source of truth instead of duplicated magic numbers. */
  maxActiveShares: number;
  maxShareExpiryDays: number;
};

function isActive(share: ReportShareDto, now: number): boolean {
  return share.revokedAt === null && share.expiresAt.getTime() > now;
}

/**
 * "Sharing" tab body. The list itself (`initialShares`) is never mirrored into local state —
 * there's no GET /api/report/shares to refetch client-side (only POST create / DELETE revoke /
 * GET one link's views exist), so every mutation calls router.refresh() and lets
 * app/dashboard/page.tsx's server-side listSharesForUser re-derive the prop from scratch. This
 * component and its children only ever own transient UI state (dialog open, per-row
 * pending-confirm/loading/error, the live-region announcement).
 */
export function SharingPanel({ latestReadyReportJobId, initialShares, maxActiveShares, maxShareExpiryDays }: SharingPanelProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const activeCount = useMemo(() => {
    // `new Date().getTime()`, not `Date.now()` — this repo's react-hooks/purity lint rule flags
    // `Date.now` as a known-impure call reachable from render, including inside useMemo.
    const now = new Date().getTime();
    return initialShares.filter((share) => isActive(share, now)).length;
  }, [initialShares]);

  const capReached = activeCount >= maxActiveShares;
  const canCreate = latestReadyReportJobId !== null && !capReached;

  function handleCreated() {
    setAnnouncement("Share link created");
    router.refresh();
  }

  function handleRevoked() {
    router.refresh();
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">Sharing</h2>
          <p className="mt-1 text-(length:--type-caption-size) text-ink-muted-80">
            Create time-limited links so lenders or landlords can view your verified income report without an account.
          </p>
        </div>
        <PillButton
          type="button"
          variant="primary"
          size="compact"
          onClick={() => setDialogOpen(true)}
          disabled={!canCreate}
        >
          Create share link
        </PillButton>
      </div>

      {!latestReadyReportJobId ? (
        <Card className="text-center">
          <LinkIcon className="mx-auto h-6 w-6 text-ink-muted-48" />
          <p className="mt-2 text-(length:--type-body-size) text-ink-muted-80">
            Generate a report first — head to the Report tab to create your verified income report, then come back here
            to share it.
          </p>
        </Card>
      ) : capReached ? (
        <Card className="text-center">
          <p className="text-(length:--type-body-size) text-ink-muted-80">
            {maxActiveShares} of {maxActiveShares} active links — revoke one to create another.
          </p>
        </Card>
      ) : null}

      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      <ShareLinksList shares={initialShares} onRevoked={handleRevoked} onAnnounce={setAnnouncement} />

      {latestReadyReportJobId ? (
        <CreateShareDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          reportJobId={latestReadyReportJobId}
          maxShareExpiryDays={maxShareExpiryDays}
          onCreated={handleCreated}
        />
      ) : null}
    </div>
  );
}
