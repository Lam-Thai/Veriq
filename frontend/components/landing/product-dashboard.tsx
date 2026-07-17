import { SectionEyebrow } from "@/components/ui/section-eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { DashboardTabs } from "@/components/landing/dashboard-tabs";

// Hierarchy: eyebrow → H2 → tab bar (client) → mockup artifact
export function ProductDashboard() {
  return (
    <section className="bg-canvas px-6 py-(--spacing-section)">
      <Reveal className="mx-auto max-w-text text-center">
        <SectionEyebrow>The product</SectionEyebrow>
        <h2 className="mt-3 text-(length:--type-display-lg-size)/(--type-display-lg-lh) tracking-(--type-display-lg-ls) font-semibold text-ink">
          A dashboard that does the explaining
        </h2>
      </Reveal>

      <div className="mx-auto mt-10 max-w-grid">
        <DashboardTabs />
      </div>
    </section>
  );
}
