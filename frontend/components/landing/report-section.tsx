import { SectionEyebrow } from "@/components/ui/section-eyebrow";
import { PillButton } from "@/components/ui/pill-button";
import { CheckIcon } from "@/components/ui/icons";
import { ReportMockup } from "@/components/landing/report-mockup";

const CHECKLIST_ITEMS: string[] = [
  "Total verified income across every source",
  "Monthly averages and 12-month trend",
  "Per-platform breakdown with deposit counts",
  "A verification certificate lenders can authenticate",
  "Export as PDF or share a secure verified link",
];

// Hierarchy: eyebrow → H2 → body → checklist → CTA, beside the report mockup artifact
export function ReportSection() {
  return (
    <section id="the-report" className="bg-surface-tile-1 px-6 py-(--spacing-section)">
      <div className="mx-auto grid max-w-grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionEyebrow tone="dark">The report</SectionEyebrow>
          <h2 className="mt-3 text-(length:--type-display-lg-size)/(--type-display-lg-lh) tracking-(--type-display-lg-ls) font-semibold text-white">
            One document. Every dollar, verified.
          </h2>
          <p className="mt-5 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-body-muted">
            A professional, lender-ready PDF that consolidates fragmented earnings into a single
            verified total — complete with a verification certificate lenders can trust.
          </p>

          <ul className="mt-7 flex flex-col gap-3">
            {CHECKLIST_ITEMS.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-primary-on-dark" />
                <span className="text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-white">
                  {item}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-8">
            <PillButton as="a" href="#" variant="primary">
              View full report
            </PillButton>
          </div>
        </div>

        <div className="flex justify-center">
          <ReportMockup />
        </div>
      </div>
    </section>
  );
}
