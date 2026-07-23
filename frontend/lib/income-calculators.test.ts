import { describe, it, expect } from "vitest";
import type { DashboardStats, MonthlyAmount, UserConnection } from "@/lib/dashboard-data";
import {
  computeAffordability,
  computeIncomeProjection,
  computeStabilityScore,
  computeTaxSetAside,
  DEFAULT_TAX_RATE_PCT,
  MAX_TAX_RATE_PCT,
  parseNonNegativeAmount,
} from "@/lib/income-calculators";

// --- Fixtures ---------------------------------------------------------------

function breakdown(amounts: number[]): MonthlyAmount[] {
  return amounts.map((amount, index) => ({ month: `M${index + 1}`, amount }));
}

function makeStats(overrides: Partial<DashboardStats> = {}): DashboardStats {
  return {
    totalVerified: 12_000,
    thisMonth: 2_500,
    averageMonthly: 2_000,
    monthlyBreakdown: breakdown([1_800, 1_900, 2_000, 2_000, 2_100, 2_200]),
    ...overrides,
  };
}

function makeConnection(slug: string, verifiedAmount: number): UserConnection {
  return { slug, verifiedAmount, connectedAt: new Date("2026-01-01T00:00:00.000Z") };
}

// --- parseNonNegativeAmount -------------------------------------------------

describe("parseNonNegativeAmount", () => {
  it("parses a positive decimal", () => {
    expect(parseNonNegativeAmount("12.5")).toBe(12.5);
  });

  it("treats blank, non-numeric, and negative input as 0", () => {
    expect(parseNonNegativeAmount("")).toBe(0);
    expect(parseNonNegativeAmount("abc")).toBe(0);
    expect(parseNonNegativeAmount("-5")).toBe(0);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseNonNegativeAmount("  30  ")).toBe(30);
  });
});

// --- computeIncomeProjection (Feature A) ------------------------------------

describe("computeIncomeProjection", () => {
  it("returns null when there is no verified income", () => {
    expect(computeIncomeProjection(makeStats({ totalVerified: 0 }), [])).toBeNull();
  });

  it("annualizes the monthly average and reports growth", () => {
    const stats = makeStats({ averageMonthly: 2_000, monthlyBreakdown: breakdown([100, 110, 121]) });
    const projection = computeIncomeProjection(stats, [makeConnection("uber", 12_000)]);

    expect(projection).not.toBeNull();
    expect(projection!.annualizedIncome).toBe(24_000);
    // latest month-over-month: (121 - 110) / 110 = 0.1
    expect(projection!.latestMonthGrowthPct).toBeCloseTo(0.1, 10);
    // average of the two consecutive +10% steps
    expect(projection!.averageMonthlyGrowthPct).toBeCloseTo(0.1, 10);
  });

  it("reports null growth when earlier months are zero (nothing to divide by)", () => {
    const stats = makeStats({ averageMonthly: 1_000, monthlyBreakdown: breakdown([0, 0, 6_000]) });
    const projection = computeIncomeProjection(stats, [makeConnection("uber", 6_000)]);

    expect(projection!.latestMonthGrowthPct).toBeNull();
    expect(projection!.averageMonthlyGrowthPct).toBeNull();
  });

  it("ranks contributions by amount and computes each share of the total", () => {
    const stats = makeStats({ totalVerified: 10_000 });
    const projection = computeIncomeProjection(stats, [
      makeConnection("uber", 2_500),
      makeConnection("stripe", 7_500),
      makeConnection("venmo", 0), // zero-amount sources are excluded
    ]);

    expect(projection!.contributions).toHaveLength(2);
    expect(projection!.contributions[0]).toMatchObject({ name: "Stripe", amount: 7_500, sharePct: 75 });
    expect(projection!.contributions[1]).toMatchObject({ name: "Uber", amount: 2_500, sharePct: 25 });
    const shareSum = projection!.contributions.reduce((sum, c) => sum + c.sharePct, 0);
    expect(shareSum).toBeCloseTo(100, 10);
  });
});

// --- computeStabilityScore (Feature B) --------------------------------------

describe("computeStabilityScore", () => {
  it("returns null with no verified income or no positive sources", () => {
    expect(computeStabilityScore(makeStats({ totalVerified: 0 }), [])).toBeNull();
    expect(computeStabilityScore(makeStats(), [makeConnection("uber", 0)])).toBeNull();
  });

  it("scores a single source as zero diversification", () => {
    const result = computeStabilityScore(makeStats(), [makeConnection("uber", 12_000)]);
    expect(result!.diversification).toBe(0);
  });

  it("scores two equal sources at 50% diversification (1 - HHI)", () => {
    const stats = makeStats({ totalVerified: 10_000 });
    const result = computeStabilityScore(stats, [makeConnection("uber", 5_000), makeConnection("stripe", 5_000)]);
    // HHI = 0.5^2 + 0.5^2 = 0.5 -> diversification = (1 - 0.5) * 100 = 50
    expect(result!.diversification).toBe(50);
  });

  it("gives full consistency to perfectly flat income", () => {
    const stats = makeStats({ monthlyBreakdown: breakdown([2_000, 2_000, 2_000, 2_000, 2_000, 2_000]) });
    const result = computeStabilityScore(stats, [makeConnection("uber", 12_000)]);
    expect(result!.consistency).toBe(100);
  });

  it("keeps the overall score within 0-100 and maps it to a band", () => {
    const result = computeStabilityScore(makeStats({ totalVerified: 10_000 }), [
      makeConnection("uber", 5_000),
      makeConnection("stripe", 5_000),
    ]);
    expect(result!.score).toBeGreaterThanOrEqual(0);
    expect(result!.score).toBeLessThanOrEqual(100);
    expect(["strong", "solid", "moderate", "developing"]).toContain(result!.band);
  });
});

// --- computeTaxSetAside (Feature C) -----------------------------------------

describe("computeTaxSetAside", () => {
  it("splits the annual set-aside across the year at the given rate", () => {
    const result = computeTaxSetAside(12_000, 25);
    expect(result.annualSetAside).toBe(3_000);
    expect(result.quarterlySetAside).toBe(750);
    expect(result.monthlySetAside).toBe(250);
    expect(result.afterTaxMonthly).toBe(750); // 1000 gross monthly - 250 set aside
  });

  it("clamps the rate to the supported range", () => {
    expect(computeTaxSetAside(12_000, 200).ratePct).toBe(MAX_TAX_RATE_PCT);
    expect(computeTaxSetAside(12_000, -5).ratePct).toBe(0);
  });

  it("floors a negative annual income at 0", () => {
    const result = computeTaxSetAside(-1_000, DEFAULT_TAX_RATE_PCT);
    expect(result.annualIncome).toBe(0);
    expect(result.annualSetAside).toBe(0);
  });
});

// --- computeAffordability (Feature D) ---------------------------------------

describe("computeAffordability", () => {
  it("computes DTI, max rent, and max housing headroom", () => {
    const result = computeAffordability(4_000, 1_000, 0);
    expect(result.dtiRatio).toBeCloseTo(0.25, 10);
    expect(result.dtiBand).toBe("healthy");
    expect(result.maxRentByIncomeRule).toBeCloseTo(1_333.33, 2);
    // 4000 * 0.36 - 1000 = 440
    expect(result.maxHousingPaymentAtThreshold).toBe(440);
  });

  it("returns a null ratio when income is 0 (nothing to divide by)", () => {
    const result = computeAffordability(0, 500, 500);
    expect(result.dtiRatio).toBeNull();
    expect(result.dtiBand).toBeNull();
  });

  it("clamps negative inputs to 0", () => {
    const result = computeAffordability(3_000, -200, -50);
    expect(result.monthlyDebt).toBe(0);
    expect(result.monthlyHousing).toBe(0);
    expect(result.dtiRatio).toBe(0);
  });

  it.each([
    { debt: 100, band: "healthy" },
    { debt: 360, band: "moderate" },
    { debt: 430, band: "elevated" },
    { debt: 500, band: "high" },
  ])("bands a DTI of $debt/1000 as $band", ({ debt, band }) => {
    expect(computeAffordability(1_000, debt, 0).dtiBand).toBe(band);
  });
});
