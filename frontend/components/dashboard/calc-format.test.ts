import { describe, it, expect } from "vitest";
import { formatUsd, formatUsdExact, formatUsdSafe } from "@/components/dashboard/calc-format";

describe("formatUsd (whole-dollar estimates)", () => {
  it("rounds to whole dollars", () => {
    expect(formatUsd(1_234.56)).toBe("$1,235");
  });
});

describe("formatUsdExact (stored amounts)", () => {
  it("always shows cents so a sub-dollar amount never reads as $0", () => {
    expect(formatUsdExact(0.4)).toBe("$0.40");
    expect(formatUsdExact(19.99)).toBe("$19.99");
  });
});

describe("formatUsdSafe (guarded whole-dollar)", () => {
  it("shows whole dollars for normal magnitudes", () => {
    expect(formatUsdSafe(1_234.56)).toBe("$1,235");
  });

  it("never collapses a real non-zero value to $0 — falls back to cents", () => {
    // The design-system money trap: whole-dollar rounding turns $0.30 into "$0".
    expect(formatUsdSafe(0.3)).toBe("$0.30");
    expect(formatUsdSafe(0.4)).toBe("$0.40");
    expect(formatUsdSafe(-0.3)).toBe("-$0.30");
  });

  it("renders a true zero as $0", () => {
    expect(formatUsdSafe(0)).toBe("$0");
  });
});
