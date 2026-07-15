"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { SpinnerIcon } from "@/components/ui/icons";
import type { IncomeInsightsData, IncomeNarrativeOutput } from "@/lib/prompts/income-narrative";

type FetchState =
  | { phase: "loading" }
  | { phase: "empty" }
  | { phase: "error" }
  | { phase: "ready"; insights: IncomeNarrativeOutput };

type AiInsightsCardProps = {
  /** Server-computed from the same connections list the rest of the Overview tab renders from —
   * lets this card render its empty state without ever attempting an AI call when there's
   * nothing to summarize yet. */
  hasConnections: boolean;
};

const STABILITY_LABEL: Record<IncomeNarrativeOutput["stabilityRating"], string> = {
  stable: "Stable",
  moderate: "Moderate",
  variable: "Variable",
};

const TREND_LABEL: Record<IncomeNarrativeOutput["trendDirection"], string> = {
  increasing: "Increasing",
  stable: "Steady",
  decreasing: "Decreasing",
};

/**
 * Fetches the signed-in user's AI-generated income summary from /api/ai/income-insights on
 * mount. Kept client-side (rather than an RSC await in app/dashboard/page.tsx) because the
 * underlying Gemini call can be slow — this must never block the dashboard's initial server
 * render. Renders all four states required by .claude/skills/design-system/SKILL.md: empty (no
 * connections — no AI call attempted), loading (skeleton, not a spinner blocking the whole
 * card), error (contained to this card — never breaks the rest of the dashboard), and populated.
 */
export function AiInsightsCard({ hasConnections }: AiInsightsCardProps) {
  // `hasConnections` is computed once, server-side, from the same connections list the rest of
  // the Overview tab renders from, so it's effectively fixed for the lifetime of this component —
  // the initial state below is the empty-state branch's only source of truth, so the effect can
  // stay a plain "fetch on mount" subscription without also needing to setState synchronously
  // for the case this initializer already covers.
  const [state, setState] = useState<FetchState>(hasConnections ? { phase: "loading" } : { phase: "empty" });

  useEffect(() => {
    if (!hasConnections) return; // no connections yet — never attempt an AI call.

    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const res = await fetch("/api/ai/income-insights", { signal: controller.signal });
        if (!res.ok) {
          if (!cancelled) setState({ phase: "error" });
          return;
        }

        const body: { data: IncomeInsightsData } = await res.json();
        if (cancelled) return;

        if (body.data.status === "no_data") {
          setState({ phase: "empty" });
        } else {
          setState({ phase: "ready", insights: body.data.insights });
        }
      } catch {
        // Includes the AbortError fired by the cleanup below on unmount — `cancelled` is already
        // true by then, so the guard skips setState rather than flashing an error post-unmount.
        if (!cancelled) setState({ phase: "error" });
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [hasConnections]);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <p className="text-(length:--type-caption-size) font-semibold text-ink">AI income insights</p>
        {state.phase === "loading" ? <SpinnerIcon className="h-4 w-4 text-ink-muted-48" /> : null}
      </div>

      <div className="mt-4" aria-live="polite">
        {state.phase === "loading" ? <LoadingSkeleton /> : null}
        {state.phase === "empty" ? <EmptyState /> : null}
        {state.phase === "error" ? <ErrorState /> : null}
        {state.phase === "ready" ? <PopulatedState insights={state.insights} /> : null}
      </div>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div aria-hidden="true" className="animate-pulse space-y-3">
      <div className="h-3 w-full rounded-sm bg-black/[0.06]" />
      <div className="h-3 w-5/6 rounded-sm bg-black/[0.06]" />
      <div className="h-3 w-2/3 rounded-sm bg-black/[0.06]" />
    </div>
  );
}

function EmptyState() {
  return (
    <p className="text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">
      Connect a platform on this tab to generate an AI-written summary of your verified income.
    </p>
  );
}

function ErrorState() {
  return (
    <p role="alert" className="text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">
      Couldn&apos;t generate your income summary — try again later.
    </p>
  );
}

function PopulatedState({ insights }: { insights: IncomeNarrativeOutput }) {
  return (
    <div>
      <p className="text-(length:--type-body-size)/(--type-body-lh) text-ink">{insights.narrative}</p>

      <div className="mt-4 flex flex-wrap gap-6">
        <div>
          <p className="text-(length:--type-fine-print-size) text-ink-muted-48">Stability</p>
          <p className="mt-0.5 text-(length:--type-caption-size) font-semibold text-ink">
            {STABILITY_LABEL[insights.stabilityRating]}
          </p>
        </div>
        <div>
          <p className="text-(length:--type-fine-print-size) text-ink-muted-48">Trend</p>
          <p className="mt-0.5 text-(length:--type-caption-size) font-semibold text-ink">
            {TREND_LABEL[insights.trendDirection]}
          </p>
        </div>
      </div>

      <p className="mt-4 text-(length:--type-caption-size) text-ink-muted-80">{insights.diversificationSummary}</p>

      {insights.notableObservations.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5">
          {insights.notableObservations.map((observation, index) => (
            <li key={`${index}-${observation}`} className="text-(length:--type-fine-print-size) text-ink-muted-80">
              {observation}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-4 text-(length:--type-fine-print-size) text-ink-muted-48">
        AI-generated description of your verified income. Not a credit score or financial advice.
      </p>
    </div>
  );
}
