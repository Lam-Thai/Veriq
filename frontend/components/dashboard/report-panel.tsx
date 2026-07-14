import Link from "next/link";
import { Card } from "@/components/ui/card";
import { PillButton } from "@/components/ui/pill-button";
import { CheckBadgeIcon } from "@/components/ui/icons";

type ReportPanelProps = {
  hasConnections: boolean;
};

/**
 * "Download report" stays a quick-download affordance (plain navigation to a route that
 * responds with Content-Disposition: attachment, app/api/report/route.tsx — no client JS
 * needed for that click) with every connected platform included. The second link sends users
 * to /dashboard/report to pick a subset of platforms before generating.
 */
export function ReportPanel({ hasConnections }: ReportPanelProps) {
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
          <PillButton as="a" href="/api/report">
            Download report
          </PillButton>
        ) : (
          <PillButton disabled>Download report</PillButton>
        )}
        <PillButton as={Link} href="/dashboard/report" variant="secondary-light" size="compact">
          {hasConnections ? "Customize & view full report" : "View report page"}
        </PillButton>
      </div>
    </Card>
  );
}
