import { SectionEyebrow } from "@/components/ui/section-eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { PlatformGrid } from "@/components/landing/platform-grid";

// Hierarchy: eyebrow → H2 → body → live status line → 11-card platform grid (client leaf)
export function ConnectPlatforms() {
  return (
    <section id="sources" className="bg-gradient-flow-light px-6 py-(--spacing-section)">
      <Reveal className="mx-auto max-w-text text-center">
        <SectionEyebrow>Connect what pays you</SectionEyebrow>
        <h2 className="mt-3 text-(length:--type-display-lg-size)/(--type-display-lg-lh) tracking-(--type-display-lg-ls) font-semibold text-ink">
          Every platform. One verified total.
        </h2>
        <p className="mt-5 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
          Tap to connect. Veriq matches each deposit against the source — no screenshots, no
          manual entry.
        </p>
      </Reveal>

      <div className="mx-auto mt-10 max-w-grid">
        <PlatformGrid />
      </div>
    </section>
  );
}
