import { SectionEyebrow } from "@/components/ui/section-eyebrow";
import { Card } from "@/components/ui/card";
import { DocumentIcon, ScatterIcon, ImageOffIcon, ClockIcon } from "@/components/ui/icons";
import type { ComponentType } from "react";

type ProblemCard = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
};

const PROBLEM_CARDS: ProblemCard[] = [
  {
    icon: DocumentIcon,
    title: "Lenders expect a W-2",
    body: "Underwriting models were built for salaried employees. A 1099 stack doesn't fit the box.",
  },
  {
    icon: ScatterIcon,
    title: "Income is fragmented",
    body: "Five apps, five payout schedules, five logins. No single number to point to.",
  },
  {
    icon: ImageOffIcon,
    title: "Screenshots aren't proof",
    body: "Pasted images and CSV exports can't be verified — so they get rejected.",
  },
  {
    icon: ClockIcon,
    title: "Manual docs eat your time",
    body: "Hours stitching together statements every time you apply for something new.",
  },
];

// Hierarchy: eyebrow → H2 → body → 4-card grid (icon, title, body)
export function ProblemSection() {
  return (
    <section className="bg-canvas px-6 py-(--spacing-section)">
      <div className="mx-auto max-w-text text-center">
        <SectionEyebrow>The problem</SectionEyebrow>
        <h2 className="mt-3 text-(length:--type-display-lg-size)/(--type-display-lg-lh) tracking-(--type-display-lg-ls) font-semibold text-ink">
          Traditional income verification was never built for you
        </h2>
        <p className="mt-5 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
          Lenders still ask for a W-2. But your income doesn&apos;t arrive on a single line — it&apos;s
          spread across apps, platforms, and payout schedules. Proving it shouldn&apos;t mean a
          folder of screenshots.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {PROBLEM_CARDS.map(({ icon: Icon, title, body }) => (
          <Card key={title} tone="light">
            <Icon className="h-6 w-6 text-primary" />
            <h3 className="mt-4 text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
              {title}
            </h3>
            <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
              {body}
            </p>
          </Card>
        ))}
      </div>
    </section>
  );
}
