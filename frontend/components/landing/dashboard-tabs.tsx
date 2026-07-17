"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Reveal } from "@/components/ui/reveal";
import { DashboardOverviewMockup } from "@/components/landing/dashboard-overview-mockup";

const TABS = ["Overview", "Monthly trends", "Platform breakdown", "Verification score", "Report"] as const;

type Tab = (typeof TABS)[number];

/**
 * Tab bar for the product dashboard preview. Only "Overview" has real mockup content per the
 * design spec — every other tab shows a lightweight placeholder rather than fabricated detail.
 */
export function DashboardTabs() {
  const [activeTab, setActiveTab] = useState<Tab>("Overview");

  return (
    <div>
      <div role="tablist" aria-label="Dashboard preview" className="flex flex-wrap justify-center gap-2">
        {TABS.map((tab) => {
          const isActive = tab === activeTab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "rounded-pill px-4 py-2 text-(length:--type-button-utility-size) font-semibold",
                "transition-colors duration-(--duration-fast)",
                "active:scale-(--press-scale)",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
                isActive
                  ? "bg-primary text-on-primary"
                  : "bg-transparent text-ink-muted-80 hover:bg-black/[0.04]",
              )}
            >
              {tab}
            </button>
          );
        })}
      </div>

      <div className="mt-10">
        {activeTab === "Overview" ? (
          <Reveal>
            <DashboardOverviewMockup />
          </Reveal>
        ) : (
          <div
            role="tabpanel"
            className="mx-auto flex min-h-64 w-full max-w-4xl items-center justify-center rounded-lg border border-hairline bg-canvas-parchment p-10 text-center"
          >
            <p className="text-(length:--type-body-size) text-ink-muted-48">
              {activeTab} preview coming soon.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
