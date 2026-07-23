"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PillButton } from "@/components/ui/pill-button";
import { CheckBadgeIcon, ClockIcon } from "@/components/ui/icons";
import { useReportDownload } from "@/hooks/use-report-download";
import { findPlatformBySlug } from "@/components/landing/platform-data";
import { cn } from "@/lib/cn";
import type { ReportHistoryEntry } from "@/lib/report-jobs";

type ReportPanelProps = {
  hasConnections: boolean;
  /** Metadata-only history — survives PDF expiry (see lib/report-jobs.tsx). */
  history: ReportHistoryEntry[];
  /** Non-null while the plan's validity-window wait blocks a new report; see
   * lib/report-jobs.tsx's getNextReportAvailableAt. Null on Enterprise (no wait) or once the
   * wait has elapsed. */
  nextReportAvailableAt: Date | null;
  reportValidityDays: number;
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function platformsLabel(platformsParam: string | null): string {
  if (platformsParam === null) return "All connected platforms";
  const slugs = platformsParam
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
  if (slugs.length === 0) return "All connected platforms";
  return slugs.map((slug) => findPlatformBySlug(slug)?.name ?? slug).join(", ");
}

function statusLabel(entry: ReportHistoryEntry): string {
  if (entry.status === "PENDING" || entry.status === "PROCESSING") return "Generating…";
  if (entry.status === "FAILED") return "Failed";
  return entry.isExpired ? "Expired" : "Ready";
}

/**
 * "Download report" starts an async report job and downloads it once ready (see
 * hooks/use-report-download.ts — app/api/report/route.tsx no longer renders synchronously, so
 * this can no longer be a plain `<a href>` navigation like it used to be) with every connected
 * platform included. The second link sends users to /dashboard/report to pick a subset of
 * platforms before generating. Below that, a metadata-only history list (see
 * lib/report-jobs.tsx's getReportHistory) shows past jobs even after their PDF has expired.
 */
export function ReportPanel({ hasConnections, history, nextReportAvailableAt, reportValidityDays }: ReportPanelProps) {
  const router = useRouter();
  const { status, errorMessage, download } = useReportDownload();
  const isGenerating = status === "generating";
  const isBlockedByValidity = nextReportAvailableAt !== null && nextReportAvailableAt > new Date();

  return (
    <div className="mx-auto max-w-md">
      <Card className="text-center">
        <CheckBadgeIcon className="mx-auto h-8 w-8 text-primary" />
        <h2 className="mt-3 text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
          Verified income report
        </h2>
        <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">
          {hasConnections
            ? "A lender-ready PDF with your total verified income and a per-platform breakdown."
            : "Connect at least one platform on the Overview tab to generate your report."}
        </p>
        <p className="mt-2 text-(length:--type-fine-print-size) text-ink-muted-48">
          Reports on your plan stay valid for {reportValidityDays} days.
        </p>

        <div className="mt-6 flex flex-col items-center gap-3">
          {hasConnections ? (
            <PillButton
              type="button"
              onClick={() => void download(undefined, () => router.refresh())}
              disabled={isGenerating || isBlockedByValidity}
            >
              {isGenerating ? "Generating…" : "Download report"}
            </PillButton>
          ) : (
            <PillButton disabled>Download report</PillButton>
          )}
          {isBlockedByValidity && nextReportAvailableAt ? (
            <p className="text-(length:--type-fine-print-size) text-ink-muted-48">
              Your next report can be generated on {DATE_FORMAT.format(nextReportAvailableAt)}.
            </p>
          ) : null}
          {status === "error" && errorMessage ? (
            <p role="alert" className="text-(length:--type-fine-print-size) text-danger">
              {errorMessage}
            </p>
          ) : null}
          <PillButton as={Link} href="/dashboard/report" variant="secondary-light" size="compact">
            {hasConnections ? "Customize & view full report" : "View report page"}
          </PillButton>
        </div>
      </Card>

      {history.length > 0 ? (
        <Card className="mt-6">
          <div className="flex items-center gap-2">
            <ClockIcon className="h-4 w-4 text-ink-muted-48" />
            <p className="text-(length:--type-caption-size) font-semibold text-ink">Report history</p>
          </div>
          <ul className="mt-4 flex flex-col gap-3">
            {history.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-4 border-b border-hairline pb-3 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-(length:--type-caption-size) font-semibold text-ink">
                    {DATE_FORMAT.format(entry.createdAt)}
                  </p>
                  <p className="mt-0.5 truncate text-(length:--type-fine-print-size) text-ink-muted-48">
                    {platformsLabel(entry.platformsParam)}
                  </p>
                  {entry.validUntil && !entry.isExpired ? (
                    <p className="mt-0.5 text-(length:--type-fine-print-size) text-ink-muted-48">
                      Valid until {DATE_FORMAT.format(entry.validUntil)}
                    </p>
                  ) : null}
                </div>
                <span
                  className={cn(
                    "shrink-0 text-(length:--type-fine-print-size) font-semibold",
                    entry.status === "READY" && !entry.isExpired && "text-verified",
                    entry.status === "FAILED" && "text-danger",
                    (entry.status === "PENDING" || entry.status === "PROCESSING" || entry.isExpired) &&
                      "text-ink-muted-48",
                  )}
                >
                  {statusLabel(entry)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
