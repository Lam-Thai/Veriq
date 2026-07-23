import type { PlanId } from "@/lib/plans";

/**
 * Server-side entitlement numbers behind each plan tier — the actual enforcement counterpart to
 * lib/plans.ts's marketing copy. `maxPlatforms: null` means unlimited. `reportValidityDays` is how
 * long a generated report stays "current" for the plan (surfaced to the user and, when
 * `requiresValidityWaitForNewReport` is true, used to gate when the next report can be generated —
 * see lib/report-jobs.ts's getNextReportAvailableAt). Enterprise skips that wait entirely (bulk
 * generation is out of scope, but nothing stops back-to-back single reports) and gets a longer
 * validity window than Pro.
 */
export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: { maxPlatforms: 2, reportValidityDays: 7, requiresValidityWaitForNewReport: true },
  pro: { maxPlatforms: null, reportValidityDays: 90, requiresValidityWaitForNewReport: true },
  enterprise: { maxPlatforms: null, reportValidityDays: 180, requiresValidityWaitForNewReport: false },
};

export type PlanLimits = {
  maxPlatforms: number | null;
  reportValidityDays: number;
  requiresValidityWaitForNewReport: boolean;
};
