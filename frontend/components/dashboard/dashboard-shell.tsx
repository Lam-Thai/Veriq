"use client";

import { useState, type ReactNode } from "react";
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
export function DashboardShell({ overview, report, account }: DashboardShellProps) {
  const [activeSection, setActiveSection] = useState<Section>("Overview");
  const panels: Record<Section, ReactNode> = { Overview: overview, Report: report, Account: account };

  return (
    <div className="mx-auto w-full max-w-grid">
      <div role="tablist" aria-label="Dashboard" className="flex flex-wrap justify-center gap-2">
        {SECTIONS.map((section) => {
          const isActive = section === activeSection;
          return (
            <button
              key={section}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`dashboard-panel-${PANEL_BY_SECTION[section]}`}
              onClick={() => setActiveSection(section)}
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

      <div className="mt-8" role="tabpanel" id={`dashboard-panel-${PANEL_BY_SECTION[activeSection]}`}>
        {panels[activeSection]}
      </div>
    </div>
  );
}
