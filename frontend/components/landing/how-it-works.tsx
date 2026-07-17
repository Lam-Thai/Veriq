import { SectionEyebrow } from "@/components/ui/section-eyebrow";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import { PlugIcon, ShieldIcon, DocumentIcon } from "@/components/ui/icons";
import type { ComponentType } from "react";

type Step = {
  icon: ComponentType<{ className?: string }>;
  step: string;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    icon: PlugIcon,
    step: "STEP 1",
    title: "Connect accounts",
    body: "Securely link Uber, DoorDash, Airbnb, Stripe, PayPal and more in a few taps.",
  },
  {
    icon: ShieldIcon,
    step: "STEP 2",
    title: "Verify earnings",
    body: "Veriq matches each deposit to its source and confirms it — no screenshots, no edits.",
  },
  {
    icon: DocumentIcon,
    step: "STEP 3",
    title: "Generate certified report",
    body: "Download a lender-ready PDF or share a verified link that anyone can authenticate.",
  },
];

// Hierarchy: eyebrow → H2 → 3-card row (icon, STEP n label, title, body)
export function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-gradient-flow-dark px-6 py-(--spacing-section)">
      <Reveal className="mx-auto max-w-text text-center">
        <SectionEyebrow tone="dark">How it works</SectionEyebrow>
        <h2 className="mt-3 text-(length:--type-display-lg-size)/(--type-display-lg-lh) tracking-(--type-display-lg-ls) font-semibold text-white">
          Three steps to lender-ready proof
        </h2>
      </Reveal>

      <div className="mx-auto mt-12 grid max-w-grid grid-cols-1 gap-6 sm:grid-cols-3">
        {STEPS.map(({ icon: Icon, step, title, body }) => (
          <Reveal key={step}>
            <Card tone="dark">
              <Icon className="h-6 w-6 text-primary-on-dark" />
              <p className="mt-4 text-(length:--type-caption-size) font-semibold tracking-(--type-caption-ls) text-primary-on-dark">
                {step}
              </p>
              <h3 className="mt-1 text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-white">
                {title}
              </h3>
              <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-body-muted">
                {body}
              </p>
            </Card>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
