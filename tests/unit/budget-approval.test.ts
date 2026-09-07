import { describe, expect, it } from "vitest";
import {
  getBudgetTrack,
  getIndentBudgetTrack,
  parseBudgetFromCostText,
  requiresDirectorApproval,
  requiresMdApproval,
  type IndentBudgetSource,
} from "@/lib/budget-approval";

describe("budget track boundaries", () => {
  it.each([
    [0, "TL_ONLY"],
    [50_000, "TL_ONLY"],
    [50_001, "DIRECTOR"],
    [500_000, "DIRECTOR"],
    [500_001, "MD"],
  ])("%s routes to %s", (amount, track) => {
    expect(getBudgetTrack(amount)).toBe(track);
  });

  it("routes a missing amount to the Director track (fail-safe, not TL_ONLY)", () => {
    expect(getBudgetTrack(null)).toBe("DIRECTOR");
    expect(getBudgetTrack("")).toBe("DIRECTOR");
    expect(getBudgetTrack("not a number")).toBe("DIRECTOR");
  });

  it("treats a negative amount as missing rather than TL_ONLY", () => {
    expect(getBudgetTrack(-1)).toBe("DIRECTOR");
  });

  it("derives the approval requirement from the track", () => {
    expect(requiresDirectorApproval("TL_ONLY")).toBe(false);
    expect(requiresDirectorApproval("DIRECTOR")).toBe(true);
    expect(requiresDirectorApproval("MD")).toBe(true);
    expect(requiresMdApproval("DIRECTOR")).toBe(false);
    expect(requiresMdApproval("MD")).toBe(true);
  });
});

describe("routing input", () => {
  it("routes on the structured amount", () => {
    expect(getIndentBudgetTrack({ approvalBudgetAmount: 900_000 })).toBe("MD");
    expect(getIndentBudgetTrack({ approvalBudgetAmount: "40000" })).toBe("TL_ONLY");
  });

  // B-06: prose parsing used to back the routing path, so the tier a case took
  // depended on phrasing. parseBudgetFromCostText survives as a UI-only helper.
  it("ignores the free-text cost field entirely", () => {
    expect(parseBudgetFromCostText("total 40k")).toBe(40_000);
    expect(
      getIndentBudgetTrack({
        approvalBudgetAmount: null,
        // Prose that used to route this case to TL_ONLY; with no structured
        // amount it now falls to the conservative default instead.
        procurementCostCommercial: "total 40k",
      } as IndentBudgetSource)
    ).toBe("DIRECTOR");
  });
});
