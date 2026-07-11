import type { Metadata } from "next";
import { Nav } from "@/components/landing/nav";
import { SectionEyebrow } from "@/components/ui/section-eyebrow";
import { PricingGrid } from "@/components/pricing/pricing-grid";

export const metadata: Metadata = {
  title: "Pricing — Veriq",
  description:
    "Simple, transparent pricing for verified income reports. Connect your gig and freelance earnings and generate lender-ready proof of income in minutes.",
};

// Hierarchy: eyebrow → H1 → lead paragraph → 3-card pricing grid. Same eyebrow-to-heading
// rhythm as components/landing/use-cases.tsx, promoted to H1 since this is a standalone page.
export default function PricingPage() {
  return (
    <>
      <Nav />
      <main className="bg-canvas-parchment px-6 py-(--spacing-section)">
        <div className="mx-auto max-w-text text-center">
          <SectionEyebrow>Pricing</SectionEyebrow>
          <h1 className="mt-3 text-(length:--type-display-lg-size)/(--type-display-lg-lh) tracking-(--type-display-lg-ls) font-semibold text-ink">
            Simple pricing for verified income
          </h1>
          <p className="mt-5 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
            Start free with a single report, or subscribe for unlimited verified reports across
            every platform you earn on.
          </p>
        </div>

        <PricingGrid />
      </main>
    </>
  );
}
