"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const SECTIONS = ["Overview", "Report", "Account"] as const;

type Section = (typeof SECTIONS)[number];

type DashboardShellProps = {
  overview: ReactNode;
  report: ReactNode;
  account: ReactNode;
};

const PANEL_BY_SECTION: Record<Section, keyof DashboardShellProps> = {
  Overview: "overview",
  Report: "report",
  Account: "account",
};

/**
 * Client tab-shell for the authenticated dashboard. Each section's content is rendered
 * server-side by app/dashboard/page.tsx and passed in as a ReactNode prop (the RSC "children
 * slot" pattern) — this component only owns which slot is visible, so the Prisma-backed
 * Overview/Report content never has to become client JS just to live inside a tab switcher.
 */
function tabId(section: Section): string {
  return `dashboard-tab-${PANEL_BY_SECTION[section]}`;
}

export function DashboardShell({ overview, report, account }: DashboardShellProps) {
  const [activeSection, setActiveSection] = useState<Section>("Overview");
  const panels: Record<Section, ReactNode> = { Overview: overview, Report: report, Account: account };
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();

    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + delta + SECTIONS.length) % SECTIONS.length;
    const nextSection = SECTIONS[nextIndex]!;

    setActiveSection(nextSection);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="mx-auto w-full max-w-grid">
      <div role="tablist" aria-label="Dashboard" className="flex flex-wrap justify-center gap-2">
        {SECTIONS.map((section, index) => {
          const isActive = section === activeSection;
          return (
            <button
              key={section}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              id={tabId(section)}
              type="button"
              role="tab"
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              aria-controls={`dashboard-panel-${PANEL_BY_SECTION[section]}`}
              onClick={() => setActiveSection(section)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn(
                "rounded-pill px-4 py-2 text-(length:--type-button-utility-size) font-semibold",
                "transition-colors duration-(--duration-fast)",
                "active:scale-(--press-scale)",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
                isActive ? "bg-primary text-on-primary" : "bg-transparent text-ink-muted-80 hover:bg-black/[0.04]",
              )}
            >
              {section}
            </button>
          );
        })}
      </div>

      <div
        className="mt-8"
        role="tabpanel"
        id={`dashboard-panel-${PANEL_BY_SECTION[activeSection]}`}
        aria-labelledby={tabId(activeSection)}
      >
        {panels[activeSection]}
      </div>
    </div>
  );
}
