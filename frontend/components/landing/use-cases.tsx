import { SectionEyebrow } from "@/components/ui/section-eyebrow";
import { Card } from "@/components/ui/card";
import { HomeIcon, BuildingIcon, CarIcon, WalletIcon, DocumentIcon } from "@/components/ui/icons";
import type { ComponentType } from "react";

type UseCase = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
};

const USE_CASES: UseCase[] = [
  {
    icon: BuildingIcon,
    title: "Mortgage applications",
    body: "Give brokers a verified income history that underwriters accept.",
  },
  {
    icon: HomeIcon,
    title: "Apartment rentals",
    body: "Skip the pay-stub demand — share a verified link with any landlord.",
  },
  {
    icon: CarIcon,
    title: "Auto loans",
    body: "Prove steady earnings for financing on a new or used vehicle.",
  },
  {
    icon: WalletIcon,
    title: "Personal loans",
    body: "Back any personal or debt-consolidation loan with real numbers.",
  },
  {
    icon: DocumentIcon,
    title: "Business financing",
    body: "Show consistent revenue for a line of credit or small-business loan.",
  },
];

// Hierarchy: eyebrow → H2 → 5-card grid (icon, title, body). Last section on the page.
export function UseCases() {
  return (
    <section className="bg-canvas-parchment px-6 py-(--spacing-section)">
      <div className="mx-auto max-w-text text-center">
        <SectionEyebrow>Use cases</SectionEyebrow>
        <h2 className="mt-3 text-(length:--type-display-lg-size)/(--type-display-lg-lh) tracking-(--type-display-lg-ls) font-semibold text-ink">
          Proof for whatever you&apos;re applying for
        </h2>
      </div>

      <div className="mx-auto mt-12 grid max-w-grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {USE_CASES.map(({ icon: Icon, title, body }) => (
          <Card key={title} tone="light" className="bg-canvas">
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
