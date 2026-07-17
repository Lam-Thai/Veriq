import { SectionEyebrow } from "@/components/ui/section-eyebrow";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import { LockIcon, LinkIcon, SlidersIcon, ShieldIcon } from "@/components/ui/icons";
import type { ComponentType } from "react";

type SecurityCard = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
};

const SECURITY_CARDS: SecurityCard[] = [
  {
    icon: LockIcon,
    title: "Bank-grade encryption",
    body: "Data is encrypted in transit and at rest with AES-256. The same standard banks use.",
  },
  {
    icon: LinkIcon,
    title: "Secure integrations",
    body: "Read-only connections through trusted aggregators. We verify deposits — never move money.",
  },
  {
    icon: SlidersIcon,
    title: "You control permissions",
    body: "Choose exactly which sources and which period appear on every report you share.",
  },
  {
    icon: ShieldIcon,
    title: "Compliance ready",
    body: "Built to SOC 2 Type II standards, with a full audit trail behind every report.",
  },
];

// Hierarchy: eyebrow → H2 → body → 4-card grid (icon, title, body)
export function SecuritySection() {
  return (
    <section className="bg-gradient-flow-light px-6 py-(--spacing-section)">
      <Reveal className="mx-auto max-w-text text-center">
        <SectionEyebrow>Security &amp; trust</SectionEyebrow>
        <h2 className="mt-3 text-(length:--type-display-lg-size)/(--type-display-lg-lh) tracking-(--type-display-lg-ls) font-semibold text-ink">
          Your income data, under your control
        </h2>
        <p className="mt-5 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
          Veriq connects through the same secure infrastructure banks use. We read deposits to
          verify them — we never move your money, and you decide what&apos;s shared.
        </p>
      </Reveal>

      <div className="mx-auto mt-12 grid max-w-grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {SECURITY_CARDS.map(({ icon: Icon, title, body }) => (
          <Reveal key={title}>
            <Card tone="light">
              <Icon className="h-6 w-6 text-primary" />
              <h3 className="mt-4 text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
                {title}
              </h3>
              <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
                {body}
              </p>
            </Card>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
