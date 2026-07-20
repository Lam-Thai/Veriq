"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { PillButton } from "@/components/ui/pill-button";
import { CheckBadgeIcon } from "@/components/ui/icons";
import { useReportDownload } from "@/hooks/use-report-download";

type ReportPanelProps = {
  hasConnections: boolean;
};

/**
 * "Download report" starts an async report job and downloads it once ready (see
 * hooks/use-report-download.ts — app/api/report/route.tsx no longer renders synchronously, so
 * this can no longer be a plain `<a href>` navigation like it used to be) with every connected
 * platform included. The second link sends users to /dashboard/report to pick a subset of
 * platforms before generating.
 */
export function ReportPanel({ hasConnections }: ReportPanelProps) {
  const { status, errorMessage, download } = useReportDownload();
  const isGenerating = status === "generating";

  return (
    <Card className="mx-auto max-w-md text-center">
      <CheckBadgeIcon className="mx-auto h-8 w-8 text-primary" />
      <h2 className="mt-3 text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
        Verified income report
      </h2>
      <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">
        {hasConnections
          ? "A lender-ready PDF with your total verified income and a per-platform breakdown."
          : "Connect at least one platform on the Overview tab to generate your report."}
      </p>

      <div className="mt-6 flex flex-col items-center gap-3">
        {hasConnections ? (
          <PillButton type="button" onClick={() => void download()} disabled={isGenerating}>
            {isGenerating ? "Generating…" : "Download report"}
          </PillButton>
        ) : (
          <PillButton disabled>Download report</PillButton>
        )}
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
  );
}
