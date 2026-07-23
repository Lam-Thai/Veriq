"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PillButton } from "@/components/ui/pill-button";
import { cn } from "@/lib/cn";
import { useReportDownload } from "@/hooks/use-report-download";
import { computeAverageMonthly } from "@/lib/income-math";

const CURRENCY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export type ReportSource = {
  slug: string;
  name: string;
  amount: number;
};

type ReportBuilderProps = {
  sources: ReportSource[];
  reportValidityDays: number;
  /** Non-null while the plan's validity-window wait blocks a new report — see
   * lib/report-jobs.tsx's getNextReportAvailableAt. */
  nextReportAvailableAt: Date | null;
};

/**
 * Lets a signed-in user choose which connected platforms to include, then downloads the PDF
 * with that selection applied. The selection is carried as a `platforms` param to
 * useReportDownload (see hooks/use-report-download.ts), which POSTs /api/report, polls the
 * resulting job, and triggers the blob download once it's ready — report-panel.tsx uses the same
 * hook for its all-platforms download.
 */
export function ReportBuilder({ sources, reportValidityDays, nextReportAvailableAt }: ReportBuilderProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sources.map((source) => source.slug)));
  const { status, errorMessage, download } = useReportDownload();
  const isGenerating = status === "generating";
  const isBlockedByValidity = nextReportAvailableAt !== null && nextReportAvailableAt > new Date();

  if (sources.length === 0) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <h2 className="text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
          No connected platforms yet
        </h2>
        <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">
          Connect at least one platform on the dashboard&apos;s Overview tab to build your income report.
        </p>
        <div className="mt-6">
          <PillButton as={Link} href="/dashboard">
            Go to dashboard
          </PillButton>
        </div>
      </Card>
    );
  }

  function toggle(slug: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }

  const selectedTotal = sources
    .filter((source) => selected.has(source.slug))
    .reduce((sum, source) => sum + source.amount, 0);
  // Average monthly amount across the selected sources over the same 6-month window the
  // Overview tab's "Average monthly" tile uses (see lib/income-math.ts) — an informational
  // reference figure only, never a credit score, approval, or lending decision.
  const estimatedQualifyingIncome = computeAverageMonthly(selectedTotal);

  const platformsParam = Array.from(selected).join(",");

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <div className="flex flex-wrap gap-8">
          <div>
            <p className="text-(length:--type-fine-print-size) text-ink-muted-48">Selected total</p>
            <p className="mt-1 text-3xl font-semibold text-ink">{CURRENCY.format(selectedTotal)}</p>
          </div>
          <div>
            <p className="text-(length:--type-fine-print-size) text-ink-muted-48">Estimated qualifying income</p>
            <p className="mt-1 text-3xl font-semibold text-ink">{CURRENCY.format(estimatedQualifyingIncome)}</p>
          </div>
        </div>
        <p className="mt-1 text-(length:--type-fine-print-size) text-verified">
          {selected.size} of {sources.length} {sources.length === 1 ? "source" : "sources"} included
        </p>
        <p className="mt-3 text-(length:--type-fine-print-size) text-ink-muted-48">
          Estimated qualifying income is the average monthly amount across your selected sources, for your own
          reference. It is not a credit score, an approval, or a lending decision.
        </p>
      </Card>

      <div className="mt-8">
        <p className="text-(length:--type-caption-size) font-semibold text-ink">Include in report</p>
        <ul className="mt-4 flex flex-col gap-3">
          {sources.map((source) => {
            const isChecked = selected.has(source.slug);
            return (
              <li key={source.slug}>
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-4 rounded-lg border border-hairline bg-canvas p-4",
                    "transition-colors duration-(--duration-fast) hover:bg-black/[0.02]",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(source.slug)}
                    className={cn(
                      "h-4 w-4 shrink-0 rounded-sm border-hairline accent-primary",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
                    )}
                  />
                  <span className="min-w-0 flex-1 text-(length:--type-body-size) font-semibold text-ink">
                    {source.name}
                  </span>
                  <span className="shrink-0 text-(length:--type-body-size) font-semibold text-ink-muted-80">
                    {CURRENCY.format(source.amount)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        {selected.size > 0 ? (
          <PillButton
            type="button"
            onClick={() => void download(platformsParam, () => router.refresh())}
            disabled={isGenerating || isBlockedByValidity}
          >
            {isGenerating ? "Generating…" : "Download report PDF"}
          </PillButton>
        ) : (
          <PillButton disabled>Select at least one platform</PillButton>
        )}
        <p className="text-(length:--type-fine-print-size) text-ink-muted-48">
          Reports on your plan stay valid for {reportValidityDays} days.
        </p>
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
      </div>
    </div>
  );
}
