import { describe, expect, it } from "vitest";
import { vendorEmailMatches } from "@/lib/gmail-address";

describe("vendor email matching", () => {
  it("fails closed when the vendor set is empty", () => {
    expect(vendorEmailMatches("anyone@vendor.com", new Set())).toBe(false);
  });

  it("matches case-insensitively after canonicalisation", () => {
    expect(vendorEmailMatches("Vendor@Example.com", new Set(["vendor@example.com"]))).toBe(true);
    expect(vendorEmailMatches("other@example.com", new Set(["vendor@example.com"]))).toBe(false);
  });
});
